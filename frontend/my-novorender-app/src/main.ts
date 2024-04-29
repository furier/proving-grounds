import { View, getDeviceProfile } from "@novorender/api";
import { createAPI, type SceneData } from "@novorender/data-js-api";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;

async function main(canvas: HTMLCanvasElement) {
  const gpuTier = 2;
  const deviceProfile = getDeviceProfile(gpuTier);

  const baseUrl = new URL("/novorender/api/", window.location.origin);
  const imports = await View.downloadImports({ baseUrl });

  // Initialize the data API with the Novorender data server service
  const dataApi = createAPI({
    serviceUrl: "https://data.novorender.com/api",
  });

  // Load scene metadata
  // Condos scene ID, but can be changed to any public scene ID
  const sceneData = await dataApi.loadScene("95a89d20dd084d9486e383e131242c4c");
  // Destructure relevant properties into variables
  const { url: _url } = sceneData as SceneData;
  const url = new URL(_url);
  const parentSceneId = url.pathname.replaceAll("/", "");
  url.pathname = "";

  const view = new View(canvas, deviceProfile, imports);

  // view.modifyRenderState({
  //   grid: { enabled: true },
  //   camera: {
  //     kind: "pinhole",
  //     position: [0, 0, 10],
  //     rotation: [0, 0, 0, 1],
  //     fov: 60,
  //   },
  // });

  const flightController = await view.switchCameraController("flight");

  // load the scene using URL gotten from `sceneData`
  const config = await view.loadScene(url, parentSceneId, "index.json");
  const { center, radius } = config.boundingSphere;
  view.activeController.autoFit(center, radius);

  await view.run();

  view.dispose();
}

main(canvas);
