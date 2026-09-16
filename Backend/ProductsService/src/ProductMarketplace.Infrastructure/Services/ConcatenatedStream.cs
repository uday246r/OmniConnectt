namespace ProductMarketplace.Infrastructure.Services;

/// <summary>Reads one stream after another, for a non-seekable upload whose first bytes were already read to identify it.</summary>
internal sealed class ConcatenatedStream(Stream first, Stream second) : Stream
{
    private bool _onSecond;

    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

    public override int Read(byte[] buffer, int offset, int count)
    {
        if (!_onSecond)
        {
            var n = first.Read(buffer, offset, count);
            if (n > 0) return n;
            _onSecond = true;
        }

        return second.Read(buffer, offset, count);
    }

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        if (!_onSecond)
        {
            var n = await first.ReadAsync(buffer, cancellationToken);
            if (n > 0) return n;
            _onSecond = true;
        }

        return await second.ReadAsync(buffer, cancellationToken);
    }

    public override void Flush() { }
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
