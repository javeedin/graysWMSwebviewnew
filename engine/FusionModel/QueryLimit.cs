using DuckDB.NET.Data;

namespace FusionModel
{
    /// <summary>
    /// Stops one DuckDB command after a time limit or when a token is cancelled (DuckDBCommand.Cancel interrupts the
    /// running query; the connection stays usable). <see cref="Run{T}"/> turns the interruption into a
    /// <see cref="TimeoutException"/> (limit reached) or an <see cref="OperationCanceledException"/> (cancelled).
    /// </summary>
    internal sealed class QueryLimit : IDisposable
    {
        private readonly TimeSpan? _timeout;
        private readonly CancellationToken _ct;
        private readonly Timer _timer;
        private readonly CancellationTokenRegistration _reg;
        private volatile bool _timedOut;

        public QueryLimit(DuckDBCommand cmd, TimeSpan? timeout, CancellationToken ct)
        {
            _timeout = timeout; _ct = ct;
            ct.ThrowIfCancellationRequested();
            if (timeout is { } t && t > TimeSpan.Zero)
                _timer = new Timer(_ => { _timedOut = true; try { cmd.Cancel(); } catch { } }, null, t, Timeout.InfiniteTimeSpan);
            if (ct.CanBeCanceled) _reg = ct.Register(() => { try { cmd.Cancel(); } catch { } });
        }

        public T Run<T>(Func<T> f)
        {
            try { return f(); }
            catch (Exception ex) when (_timedOut && !_ct.IsCancellationRequested && ex is not TimeoutException)
            { throw new TimeoutException("stopped after " + Math.Round(_timeout.Value.TotalSeconds) + " s (the query took too long)", ex); }
            catch (Exception ex) when (_ct.IsCancellationRequested && ex is not OperationCanceledException)
            { throw new OperationCanceledException("cancelled", ex, _ct); }
        }

        public void Dispose() { _timer?.Dispose(); _reg.Dispose(); }
    }
}
