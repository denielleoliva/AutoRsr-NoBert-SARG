from flask import Flask, request, jsonify, render_template, send_from_directory
import os
import datetime
import json
import subprocess
import whisperx
import db as database
from auto_rsr import standarize, score_rsr_errors, score_rsr, evaluate_rsr_result

app = Flask(__name__)

SENTENCE_AUDIO_FOLDER = 'sentence_audio'
RECORDINGS_FOLDER     = 'uploads/recordings'
PRE_ROLL_MS           = 2000  # seconds of audio before marker start to include

os.makedirs(SENTENCE_AUDIO_FOLDER, exist_ok=True)
os.makedirs(RECORDINGS_FOLDER, exist_ok=True)

database.init_db()

GROUND_TRUTH = [
    "The big football player washed the car with the hose.",
    "All of the pictures were colored by his little sister.",
    "The rose bushes were planted yesterday by the girl scouts.",
    "The happy little girl kicked the ball over the fence.",
    "His little brother cleaned the dirty dishes and cups.",
    "A special cage was made to hold the dangerous animals.",
    "Everybody in my school colored Easter eggs for the picnic.",
    "A new hole was dug for the kid's swimming pool.",
    "Only the first graders made a birdhouse for their parents.",
    "My little sister's dog caught the ball on the first bounce.",
    "The soccer ball was kicked into the school's parking lot.",
    "The lion's teeth were cleaned with a giant toothbrush.",
    "Some of the kids dug holes in the sand two feet deep.",
    "The little white mouse was caught by our neighbor's cat.",
    "The second grade students planted coconuts in the garden.",
    "The dirty clothes were washed with soap one more time.",
]

_whisper_model = None


def get_model():
    global _whisper_model
    if _whisper_model is None:
        _whisper_model = whisperx.load_model(
            "large-v3", "cuda", compute_type="float16", language="en"
        )
    return _whisper_model


def transcribe_file(path):
    model = get_model()
    audio = whisperx.load_audio(path)
    result = model.transcribe(audio, batch_size=16)
    texts = [seg["text"].strip() for seg in result.get("segments", []) if "text" in seg]
    return " ".join(texts).strip()


def slice_audio(session_path, start_ms, end_ms, out_path):
    """Slice session audio between start_ms and end_ms using ffmpeg."""
    start_s = max(0.0, (start_ms - PRE_ROLL_MS) / 1000)
    end_s   = end_ms / 1000
    subprocess.run(
        ['ffmpeg', '-y', '-i', session_path,
         '-ss', f'{start_s:.3f}',
         '-to', f'{end_s:.3f}',
         out_path],
        check=True,
        capture_output=True,
    )


def find_audio_file(sentence_number):
    for ext in ['mp3', 'wav', 'ogg', 'm4a', 'webm']:
        for pattern in [
            str(sentence_number),
            f'sentence_{sentence_number}',
            f'sentence_{sentence_number:02d}',
        ]:
            fname = f'{pattern}.{ext}'
            if os.path.exists(os.path.join(SENTENCE_AUDIO_FOLDER, fname)):
                return fname
    return None


# --- Routes ---

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/sentences')
def get_sentences():
    sentences = []
    for i, text in enumerate(GROUND_TRUTH, start=1):
        audio_file = find_audio_file(i)
        sentences.append({
            'id': i,
            'text': text,
            'audio_url': f'/audio/{audio_file}' if audio_file else None,
        })
    return jsonify(sentences)


@app.route('/audio/<path:filename>')
def serve_audio(filename):
    return send_from_directory(SENTENCE_AUDIO_FOLDER, filename)


@app.route('/api/analyze', methods=['POST'])
def analyze():
    patient_id = request.form.get('patient_id', '').strip()
    age        = request.form.get('age')
    percentile = request.form.get('percentile', 5)

    try:
        age        = int(age)
        percentile = int(percentile)
    except (ValueError, TypeError):
        return jsonify({'error': 'Age and percentile must be integers'}), 400

    if 'session_audio' not in request.files:
        return jsonify({'error': 'Missing session audio'}), 400

    raw_markers = request.form.get('markers', '[]')
    try:
        markers = json.loads(raw_markers)
    except json.JSONDecodeError:
        return jsonify({'error': 'Invalid markers JSON'}), 400

    if not markers:
        return jsonify({'error': 'No sentence markers received'}), 400

    timestamp      = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    session_folder = os.path.join(RECORDINGS_FOLDER, timestamp)
    os.makedirs(session_folder, exist_ok=True)

    # Save the full session recording
    session_path = os.path.join(session_folder, 'session.webm')
    request.files['session_audio'].save(session_path)

    marker_map = {m['sentence_id']: m for m in markers}

    sentence_results = []
    recording_paths  = {}

    for i, gt in enumerate(GROUND_TRUTH, start=1):
        marker = marker_map.get(i)

        if not marker:
            sentence_results.append({
                'id': str(i), 'Ground Truth': gt, 'Sentence': '',
                'Errors': 0, 'Score': 0,
                'Edit Script': {'Insertions': [], 'Deletions': [], 'Substitutions': [], 'Swaps': []},
            })
            continue

        slice_path = os.path.join(session_folder, f'sentence_{i}.wav')

        try:
            slice_audio(session_path, marker['start_ms'], marker['end_ms'], slice_path)
            recording_paths[i] = slice_path

            transcription = transcribe_file(slice_path)
            gt_std   = standarize(gt)
            resp_std = standarize(transcription)
            edits    = score_rsr_errors(resp_std.split(), gt_std.split())
            errors   = sum(len(v) for v in edits.values())
            score    = score_rsr([errors])
        except Exception:
            resp_std = ''
            edits    = {'Insertions': [], 'Deletions': [], 'Substitutions': [], 'Swaps': []}
            errors   = 0
            score    = 0

        sentence_results.append({
            'id': str(i), 'Ground Truth': gt, 'Sentence': resp_std,
            'Errors': errors, 'Score': score, 'Edit Script': edits,
        })

    total_score = sum(s['Score'] for s in sentence_results)
    result      = evaluate_rsr_result(total_score, age, percentile)

    try:
        session_id = database.save_session(
            patient_id, age, percentile, total_score, result,
            sentence_results, recording_paths, session_folder,
        )
    except Exception:
        session_id = None

    return jsonify({
        'session_id': session_id,
        'Decision': {
            'Total Score': total_score,
            'Result': result,
            'Age (months)': age,
            'Percentile': percentile,
        },
        'Edit and Score': {
            'Sentences': sentence_results,
            'Total Score': total_score,
        },
    })


@app.route('/api/sessions')
def get_sessions():
    return jsonify(database.get_sessions())


if __name__ == '__main__':
    app.run(debug=True, threaded=True)
