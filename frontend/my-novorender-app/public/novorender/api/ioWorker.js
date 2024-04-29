// /projects/Novorender/ts/dist/offline/opfs/worker/index.ts
async function handleIOWorkerMessages(message) {
  const data = message.data;
  switch (data.kind) {
    case "connect": {
      const { port } = data;
      if (port) {
        port.onmessage = async (message2) => {
          const { response, transfer } = await handleIORequest(message2.data);
          if (response) {
            port.postMessage(response, transfer);
          }
        };
      }
      break;
    }
    default: {
      const { response, transfer } = await handleIORequest(data);
      if (response) {
        self.postMessage(response, { transfer });
      }
      break;
    }
  }
}
var rootPromise = navigator.storage.getDirectory();
var dirHandles = /* @__PURE__ */ new Map();
var journalHandles = /* @__PURE__ */ new Map();
var streamHandles = /* @__PURE__ */ new Map();
var LockedHandle = class {
  constructor(handle) {
    this.handle = handle;
    this.lockPromise = Promise.resolve();
  }
  lockPromise;
  handle;
  async lock() {
    await this.lockPromise;
    let unlock;
    this.lockPromise = new Promise((resolve) => {
      unlock = resolve;
    });
    return { handle: this.handle, unlock };
  }
};
async function getDirHandle(name) {
  let dirHandle = dirHandles.get(name);
  if (!dirHandle) {
    const root = await rootPromise;
    dirHandle = await root.getDirectoryHandle(name);
    dirHandles.set(name, dirHandle);
  }
  return dirHandle;
}
async function getGetJournalHandle(name, reset) {
  let journalHandle = journalHandles.get(name);
  if (journalHandle && reset) {
    const { handle, unlock } = await journalHandle.lock();
    handle.close();
    unlock();
    journalHandle = void 0;
  }
  if (!journalHandle) {
    const dirHandle = await getDirHandle(name);
    const fileHandle = await dirHandle.getFileHandle("journal", { create: true });
    const accessHandle = await fileHandle.createSyncAccessHandle();
    journalHandle = new LockedHandle(accessHandle);
    journalHandles.set(name, journalHandle);
  }
  return journalHandle;
}
async function closeJournal(name) {
  let journalHandle = journalHandles.get(name);
  if (journalHandle) {
    const { handle, unlock } = await journalHandle.lock();
    handle.close();
    const dirHandle = await getDirHandle(name);
    dirHandle.removeEntry("journal");
    unlock();
    journalHandles.delete(name);
  }
  return journalHandle;
}
function exhaustiveGuard(_value) {
  throw new Error(`Unknown IO request message: ${JSON.stringify(_value)}`);
}
async function handleIORequest(data) {
  let response;
  let transfer = [];
  switch (data.kind) {
    case "create_dir": {
      let error;
      try {
        await createDir(data.dir);
      } catch (ex) {
        error = ex.message ?? ex.toString();
      }
      response = { kind: "create_dir", id: data.id, error };
      break;
    }
    case "dirs": {
      let error;
      let dirs = [];
      try {
        dirs = await dirNames();
      } catch (ex) {
        error = ex.message ?? ex.toString();
      }
      response = { kind: "dirs", id: data.id, dirs, error };
      break;
    }
    case "files": {
      let error;
      let files = [];
      try {
        files = await fileNames(data.dir);
      } catch (ex) {
        error = ex.message ?? ex.toString();
      }
      response = { kind: "files", id: data.id, files, error };
      break;
    }
    case "file_sizes": {
      let error;
      let sizes = [];
      try {
        sizes = await fileSizes(data.dir, data.files);
      } catch (ex) {
        error = ex.message ?? ex.toString();
      }
      response = { kind: "file_sizes", id: data.id, sizes, error };
      break;
    }
    case "read": {
      let error;
      let buffer;
      try {
        buffer = data.file == "journal" ? await readJournal(data.dir) : await readFile(data.dir, data.file);
        if (buffer) {
          transfer.push(buffer);
        }
      } catch (ex) {
        error = ex.message ?? ex.toString();
      }
      response = { kind: "read", id: data.id, buffer, error };
      break;
    }
    case "write": {
      let error;
      try {
        await writeFile(data.dir, data.file, data.buffer);
      } catch (ex) {
        error = ex.message ?? ex.toString();
        console.warn(`${data.file}: ${error}`);
      }
      response = { kind: "write", id: data.id, error };
      break;
    }
    case "open_write_stream": {
      let error;
      try {
        const handle = await createFile(data.dir, data.file, data.size);
        const key = `${data.dir}/${data.file}`;
        streamHandles.set(key, handle);
      } catch (ex) {
        error = ex.message ?? ex.toString();
        console.warn(`${data.file}: ${error}`);
      }
      response = { kind: "open_write_stream", id: data.id, error };
      break;
    }
    case "append_stream": {
      let error;
      try {
        const key = `${data.dir}/${data.file}`;
        const handle = streamHandles.get(key);
        if (handle) {
          await appendfile(handle, data.buffer);
        } else {
          throw new Error("Handle is not opened!");
        }
      } catch (ex) {
        error = ex.message ?? ex.toString();
        console.warn(`${data.file}: ${error}`);
      }
      response = { kind: "append_stream", id: data.id, error };
      break;
    }
    case "close_write_stream": {
      let error;
      try {
        const key = `${data.dir}/${data.file}`;
        const handle = streamHandles.get(key);
        if (handle) {
          finalizeFile(handle);
          streamHandles.delete(key);
        } else {
          throw new Error("Handle is not opened!");
        }
      } catch (ex) {
        error = ex.message ?? ex.toString();
        console.warn(`${data.file}: ${error}`);
      }
      response = { kind: "close_write_stream", id: data.id, error };
      break;
    }
    case "delete_files": {
      let error;
      try {
        await deleteFiles(data.dir, data.files);
      } catch (ex) {
        error = ex.message ?? ex.toString();
      }
      response = { kind: "delete_files", id: data.id, error };
      break;
    }
    case "delete_dir": {
      let error;
      try {
        await deleteDir(data.dir);
      } catch (ex) {
        error = ex.message ?? ex.toString();
      }
      response = { kind: "delete_dir", id: data.id, error };
      break;
    }
    case "delete_all": {
      let error;
      try {
        await deleteAll();
      } catch (ex) {
        error = ex.message ?? ex.toString();
      }
      response = { kind: "delete_all", id: data.id, error };
      break;
    }
    default:
      exhaustiveGuard(data);
  }
  return { response, transfer };
}
async function dirEntries(dir) {
  let output = [];
  const entries = dir.entries();
  for await (const entry of entries) {
    output.push(entry);
  }
  return output;
}
async function createDir(dir) {
  const root = await rootPromise;
  await root.getDirectoryHandle(dir, { create: true });
}
async function dirNames() {
  const root = await rootPromise;
  const entries = await dirEntries(root);
  const dirs = entries.filter(([_, value]) => value.kind == "directory").map(([name]) => name);
  return dirs;
}
async function fileNames(dir) {
  const dirHandle = await getDirHandle(dir);
  const entries = await dirEntries(dirHandle);
  const files = entries.filter(([_, value]) => value.kind == "file").map(([name]) => name);
  return files;
}
async function readFile(dir, filename) {
  try {
    const dirHandle = await getDirHandle(dir);
    const fileHandle = await dirHandle.getFileHandle(filename);
    const accessHandle = await fileHandle.createSyncAccessHandle();
    const size = accessHandle.getSize();
    const buffer = new Uint8Array(size);
    accessHandle.read(buffer);
    accessHandle.close();
    return buffer.buffer;
  } catch (error) {
    if (error instanceof DOMException && error.name == "NotFoundError") {
      return void 0;
    } else {
      console.log({ error });
      throw error;
    }
  }
}
async function fileSizes(dir, files) {
  const sizes = [];
  files ??= await fileNames(dir);
  for (const filename of files) {
    let size;
    try {
      const dirHandle = await getDirHandle(dir);
      const fileHandle = await dirHandle.getFileHandle(filename);
      const accessHandle = await fileHandle.createSyncAccessHandle();
      size = accessHandle.getSize();
      accessHandle.close();
    } catch (error) {
      if (!(error instanceof DOMException && error.name == "NotFoundError")) {
        console.log({ error });
        throw error;
      }
    }
    sizes.push(size);
  }
  return sizes;
}
async function createFile(dir, file, size) {
  const dirHandle = await getDirHandle(dir);
  const fileHandle = await dirHandle.getFileHandle(file, { create: true });
  const accessHandle = await fileHandle.createSyncAccessHandle();
  accessHandle.truncate(size);
  return { accessHandle, offset: 0, dir, file, size };
}
async function appendfile(streamHandle, buffer) {
  const { accessHandle, offset } = streamHandle;
  const bytesWritten = accessHandle.write(new Uint8Array(buffer), { at: offset });
  console.assert(bytesWritten == buffer.byteLength);
  streamHandle.offset += bytesWritten;
}
async function finalizeFile(streamHandle) {
  const { accessHandle, offset, dir, file, size } = streamHandle;
  accessHandle.flush();
  accessHandle.close();
  if (size == offset) {
    await appendJournal(dir, file, size);
  } else {
    const dirHandle = await getDirHandle(dir);
    dirHandle.removeEntry(file);
  }
}
async function writeFile(dir, file, buffer) {
  let accessHandle;
  try {
    const dirHandle = await getDirHandle(dir);
    const fileHandle = await dirHandle.getFileHandle(file, { create: true });
    accessHandle = await fileHandle.createSyncAccessHandle();
    accessHandle.truncate(buffer.byteLength);
    const bytesWritten = accessHandle.write(new Uint8Array(buffer), { at: 0 });
    console.assert(bytesWritten == buffer.byteLength);
    accessHandle.flush();
    await appendJournal(dir, file, bytesWritten);
  } finally {
    accessHandle?.close();
  }
}
async function readJournal(dir) {
  let dispose;
  try {
    const journalHandle = await getGetJournalHandle(dir, true);
    const { handle, unlock } = await journalHandle.lock();
    dispose = unlock;
    const size = handle.getSize();
    const buffer = new Uint8Array(size);
    handle.read(buffer);
    return buffer.buffer;
  } catch (error) {
    if (error instanceof DOMException && error.name == "NotFoundError") {
      return void 0;
    } else {
      console.log({ error });
      throw error;
    }
  } finally {
    dispose?.();
  }
}
async function appendJournal(dir, file, size) {
  let dispose;
  try {
    const journalHandle = await getGetJournalHandle(dir, false);
    const { handle, unlock } = await journalHandle.lock();
    dispose = unlock;
    const text = `${file},${size}
`;
    const bytes = new TextEncoder().encode(text);
    handle.write(bytes, { at: handle.getSize() });
    handle.flush();
  } finally {
    dispose?.();
  }
}
async function deleteFiles(dir, files) {
  const dirHandle = await getDirHandle(dir);
  closeJournal(dir);
  for (const file of files) {
    dirHandle.removeEntry(file);
  }
}
async function deleteDir(dir) {
  const root = await rootPromise;
  closeJournal(dir);
  root.removeEntry(dir, { recursive: true });
}
async function deleteAll() {
  const root = await rootPromise;
  const entries = await dirEntries(root);
  for (const [name] of entries) {
    closeJournal(name);
    root.removeEntry(name, { recursive: true });
  }
}

// /projects/Novorender/ts/dist/offline/opfs/worker/worker.ts
onmessage = handleIOWorkerMessages;
//# sourceMappingURL=ioWorker.js.map
