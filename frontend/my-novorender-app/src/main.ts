import { FlightController, View, createNeutralHighlight, getDeviceProfile, type RenderStateHighlightGroups } from "@novorender/api";
import { createAPI, type ObjectDB, type SceneData } from "@novorender/data-js-api";

function setupCameraButton(buttonId: string, flightController: FlightController) {
  const camera = document.getElementById(buttonId) as HTMLButtonElement;
  let cameraState: any = null;
  camera.onclick = async (event) => {
    if (event.shiftKey) {
      // save camera position and rotation
      cameraState = {
        position: flightController.position,
        rotation: flightController.rotation,
      };
    } else if (cameraState) {
      // load camera position and rotation
      flightController.moveTo(cameraState.position, 1000, cameraState.rotation);
    }
  };
}

async function search(search: string, db: ObjectDB, view: View, signal: AbortSignal) {
  try {
    // Run the searches
    const iterator = db.search({ searchPattern: search }, signal);

    // In this example we just want to isolate the objects so all we need is the object ID
    const result: number[] = [];
    for await (const object of iterator) {
      result.push(object.id);
    }

    if (result.length) {
      // Then we isolate the objects found
      const renderStateHighlightGroups: RenderStateHighlightGroups = {
        defaultAction: "hide",
        groups: [{ action: createNeutralHighlight(), objectIds: result }],
      };

      // Finally, modify the renderState
      view.modifyRenderState({ highlights: renderStateHighlightGroups });
    } else {
      view.modifyRenderState({ highlights: { defaultAction: undefined, groups: [] } });
    }
  } catch (error) {
    console.warn(error);
  }
}

function setupSearch(view: View, db?: ObjectDB) {
  if (!db) return;

  const searchForm = document.getElementById("searchForm") as HTMLFormElement;

  let controller = new AbortController();

  searchForm.onsubmit = (event) => {
    event.preventDefault();
    controller.abort("Search aborted");
    controller = new AbortController();
    search(searchForm.searchInput.value, db, view, controller.signal);
  };
}

async function main(canvas: HTMLCanvasElement) {
  const gpuTier = 2;
  const deviceProfile = getDeviceProfile(gpuTier);

  const baseUrl = new URL("/novorender/api/", window.location.origin);
  const imports = await View.downloadImports({ baseUrl });

  // Initialize the data API with the Novorender data server service
  const dataApi = createAPI({ serviceUrl: "https://data.novorender.com/api" });

  // Load scene metadata
  // Condos scene ID, but can be changed to any public scene ID
  const sceneData = await dataApi.loadScene("95a89d20dd084d9486e383e131242c4c");
  // Destructure relevant properties into variables
  const { url: _url, db } = sceneData as SceneData;
  const url = new URL(_url);
  const parentSceneId = url.pathname.replaceAll("/", "");
  url.pathname = "";

  const view = new View(canvas, deviceProfile, imports);

  view.modifyRenderState({
    grid: { enabled: true },
    camera: {
      kind: "pinhole",
      position: [0, 0, 10],
      rotation: [0, 0, 0, 1],
      fov: 60,
    },
  });

  const flightController = await view.switchCameraController("flight");

  setupCameraButton("camera1", flightController);
  setupCameraButton("camera2", flightController);
  setupCameraButton("camera3", flightController);

  setupSearch(view, db);

  // load the scene using URL gotten from `sceneData`
  const config = await view.loadScene(url, parentSceneId, "index.json");
  const { center, radius } = config.boundingSphere;
  view.activeController.autoFit(center, radius);

  await view.run();

  view.dispose();
}

const canvas = document.getElementById("canvas") as HTMLCanvasElement;

main(canvas);
