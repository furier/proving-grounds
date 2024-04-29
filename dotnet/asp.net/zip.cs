using System.IO.Compression;

static class Zip
{
    // Write a zip file with specified number of files of 1MiB each with random content.
    public static void Write(Stream stream, int files)
    {
        var seed = 123;
        var rnd = new Random(seed);
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, true))
        {
            var buffer = new byte[0x100000];
            for (var i = 0; i < files; i++)
            {
                rnd.NextBytes(buffer);
                var name = i.ToString();
                var entry = archive.CreateEntry(name);
                using (var entryStream = entry.Open())
                {
                    entryStream.Write(buffer);
                }
            }
        }
    }
}
