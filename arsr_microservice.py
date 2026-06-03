"""
AutoRSR microservice — analysis only.
Called internally by the Bloom .NET backend.
No database, no web UI, no authentication.

POST /api/analyze
  form fields: age (int), percentile (int)
  form files:  session_audio (webm/wav)
  form fields: markers (JSON array of {sentence_id, start_ms, end_ms})
  returns:     scored results JSON
"""

import os
import json
import datetime
import subprocess
import whisperx
from flask import Flask, request, jsonify
from auto_rsr import standarize, score_rsr_errors, score_rsr, evaluate_rsr_result

app = Flask(__name__)

RECORDINGS_DIR = os.environ.get('ARSR_RECORDINGS_DIR', 'uploads/recordings')
PRE_ROLL_MS    = 2000

os.makedirs(RECORDINGS_DIR, exist_ok=True)

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

_model = None


def get_model():
    global _model
    if _model is None:
        _model = whisperx.load_model("large-v3", "cuda", compute_type="float16", language="en")
    return _model


def transcribe(path):
    model = get_model()
    audio  = whisperx.load_audio(path)
    result = model.transcribe(audio, batch_size=16)
    texts  = [s["text"].strip() for s in result.get("segments", []) if "text" in s]
    return " ".join(texts).strip()


def slice_audio(session_path, start_ms, end_ms, out_path):
    start_s = max(0.0, (start_ms - PRE_ROLL_MS) / 1000)
    end_s   = end_ms / 1000
    subprocess.run(
        ['ffmpeg', '-y', '-i', session_path,
         '-ss', f'{start_s:.3f}', '-to', f'{end_s:.3f}', out_path],
        check=True, capture_output=True,
    )


@app.route('/health')
def health():
    return jsonify({'ok': True})


@app.route('/api/analyze', methods=['POST'])
def analyze():
    try:
        age        = int(request.form.get('age', 0))
        percentile = int(request.form.get('percentile', 5))
    except (ValueError, TypeError):
        return jsonify({'error': 'age and percentile must be integers'}), 400

    if 'session_audio' not in request.files:
        return jsonify({'error': 'Missing session_audio'}), 400

    try:
        markers = json.loads(request.form.get('markers', '[]'))
    except json.JSONDecodeError:
        return jsonify({'error': 'Invalid markers JSON'}), 400

    if not markers:
        return jsonify({'error': 'No markers received'}), 400

    timestamp      = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    session_folder = os.path.join(RECORDINGS_DIR, timestamp)
    os.makedirs(session_folder, exist_ok=True)

    session_path = os.path.join(session_folder, 'session.webm')
    request.files['session_audio'].save(session_path)

    marker_map       = {m['sentence_id']: m for m in markers}
    sentence_results = []
    recording_paths  = {}

    for i, gt in enumerate(GROUND_TRUTH, start=1):
        marker = marker_map.get(i)

        if not marker:
            sentence_results.append({
                'id': str(i), 'groundTruth': gt, 'response': '',
                'errors': 0, 'score': 0,
                'editScript': {'Insertions': [], 'Deletions': [], 'Substitutions': [], 'Swaps': []},
            })
            continue

        slice_path = os.path.join(session_folder, f'sentence_{i}.wav')
        try:
            slice_audio(session_path, marker['start_ms'], marker['end_ms'], slice_path)
            recording_paths[str(i)] = slice_path

            transcription = transcribe(slice_path)
            gt_std   = standarize(gt)
            resp_std = standarize(transcription)
            edits    = score_rsr_errors(resp_std.split(), gt_std.split())
            errors   = sum(len(v) for v in edits.values())
            score    = score_rsr([errors])
        except Exception as e:
            resp_std = ''
            edits    = {'Insertions': [], 'Deletions': [], 'Substitutions': [], 'Swaps': []}
            errors   = 0
            score    = 0

        sentence_results.append({
            'id': str(i), 'groundTruth': gt, 'response': resp_std,
            'errors': errors, 'score': score, 'editScript': edits,
        })

    total_score = sum(s['score'] for s in sentence_results)
    result      = evaluate_rsr_result(total_score, age, percentile)

    return jsonify({
        'sessionFolder':  session_folder,
        'recordingPaths': recording_paths,
        'totalScore':     total_score,
        'result':         result,
        'sentences':      sentence_results,
    })


if __name__ == '__main__':
    port = int(os.environ.get('ARSR_PORT', 5050))
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
