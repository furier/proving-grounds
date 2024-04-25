// read all the files in the current directory
import archiver from 'archiver';
import fs from 'fs';

const manifest = fs.readFileSync('manifest.json', 'utf8');
const filenames = JSON.parse(manifest).map(({ filename: f }) => f);

const files = fs.readdirSync('.');
const filesToZip = files.filter(f => filenames.includes(f));
const filesToIgnore = ['manifest.json', 'package.json', 'node_modules', 'script.mjs', '.gitignore', 'README.md'];
const filesToDelete = files.filter(f => ![...filesToIgnore, ...filenames].includes(f));

const output = fs.createWriteStream('files.zip');
const archive = archiver('zip');

output.on('close', () => {
  console.log(archive.pointer() + ' total bytes');
  console.log('archiver has been finalized and the output file descriptor has closed.');
});

archive.on('error', err => {
  throw err;
});

archive.pipe(output);

filesToZip.forEach(file => {
  archive.file(file);
});

filesToDelete.forEach(file => {
  fs.unlinkSync(file);
});

archive.finalize();