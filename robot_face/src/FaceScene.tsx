import { useEffect } from 'react';
import { VizijRuntimeFace, useVizijRuntime } from '@vizij/runtime-react';
import { FaceBehavior } from './FaceBehavior';

export function FaceScene() {
  const { ready, loading, error, stagePoseNeutral } = useVizijRuntime();

  useEffect(() => {
    if (ready) stagePoseNeutral();
  }, [ready, stagePoseNeutral]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <VizijRuntimeFace
        style={{ width: '100%', height: '100%' }}
        showSafeArea={false}
      />
      {error && (
        <div style={overlayStyle('#c00')}>
          {error.message}
        </div>
      )}
      {!ready && !error && (
        <div style={overlayStyle('rgba(0,0,0,0.7)')}>
          {loading ? 'Loading face…' : 'Initialising…'}
        </div>
      )}
      <FaceBehavior />
    </div>
  );
}

function overlayStyle(bg: string): React.CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: bg,
    color: '#fff',
    fontFamily: 'sans-serif',
    fontSize: '1.2rem',
    pointerEvents: 'none',
  };
}
