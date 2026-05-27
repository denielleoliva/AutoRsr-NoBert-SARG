import { VizijRuntimeProvider } from '@vizij/runtime-react';
import type { VizijAssetBundle } from '@vizij/runtime-react';
import { FaceScene } from './FaceScene';

const assetBundle: VizijAssetBundle = {
  namespace: 'robot-face',
  glb: {
    kind: 'url',
    src: `${import.meta.env.BASE_URL}assets/Quori_Latest_Rigged.glb`,
    aggressiveImport: true,
    rootBounds: {
      center: { x: -0.007489, y: 0.786183 },
      size: { x: 12.068108, y: 8.769684 },
    },
  },
  pose: {
    stageNeutralFilter: (_id: string, path: string) => !path.includes('/color/'),
  },
};

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000014', overflow: 'hidden' }}>
      <VizijRuntimeProvider assetBundle={assetBundle} autostart driveOrchestrator>
        <FaceScene />
      </VizijRuntimeProvider>
    </div>
  );
}
