namespace MyVideoGameList.Server.Services.Edge;

/// <summary>
/// Paces each account's withdrawals on their way to the edge, so that no one account can spend the
/// day's invalidations, without refusing or dropping any of them.
/// </summary>
/// <remarks>
/// <para>
/// <b>The first goes at once, and the rest go together.</b> An account's withdrawal is passed on as
/// soon as it arrives unless the same account sent one less than a minute ago. Then it waits for the
/// minute, and everything else that account withdraws meanwhile joins it: one invalidation, carrying
/// every path any of them named, sent after the last of them committed, so it covers them all. Every
/// path is the profile's own wildcard, so in practice one path covers any number of withdrawals.
/// </para>
/// <para>
/// <b>Twenty at that pace, then one every fifteen minutes.</b> Each account has a bucket of twenty
/// sends, refilled at one every fifteen minutes. A person deleting a game a minute for twenty minutes
/// never waits more than the minute; a script withdrawing all day gets twenty sends and then
/// ninety-six more, and each of its withdrawals waits at most fifteen minutes. Nothing is dropped by
/// this: an invalidation that waited carries the time of the latest write it covers, so the sender
/// still retries it until sixty-five minutes after that write, and no longer.
/// </para>
/// <para>
/// <b>Three go at once</b>, whatever the account has waiting, and take it with them: the privacy
/// switch, a rename and a deletion (<see cref="EdgeInvalidation.AtOnce"/>). They are the consent acts
/// the window was closed for, and none of them can be repeated without something in between that is
/// limited per account (<c>RepublishLimits</c>) or cannot happen twice.
/// </para>
/// <para>
/// <b>Per task and in memory</b>, like the queue in front of CloudFront: each task paces what its
/// own requests withdrew, so two tasks give an account twice the pace, as they give the auth limiter
/// twice its budget. What is waiting when the host stops is sent before the queue drains, through
/// <see cref="Flush"/>; a task that dies outright loses it, as it loses its queue, and the task that
/// replaces it covers both by invalidating every profile as it starts
/// (<c>CloudFrontEdgeInvalidator.OnStart</c>).
/// </para>
/// <para>
/// See <c>docs/decisions/0081-*</c>.
/// </para>
/// </remarks>
internal sealed class WithdrawalHold : IEdgeInvalidator, IDisposable
{
    /// <summary>The pace, gathered in one place so a test can set its own.</summary>
    /// <param name="Spacing">The least time between two sends for one account.</param>
    /// <param name="Burst">How many sends an account has before the refill is what paces it.</param>
    /// <param name="Refill">How long the bucket takes to get one send back.</param>
    internal sealed record Pacing(TimeSpan Spacing, int Burst, TimeSpan Refill)
    {
        public static readonly Pacing Default = new(
            Spacing: TimeSpan.FromMinutes(1),
            Burst: 20,
            Refill: TimeSpan.FromMinutes(15));
    }

    /// <summary>One account's pace, and what it has waiting.</summary>
    private sealed class Account
    {
        /// <summary>
        /// When the bucket is full again. A send is allowed while this is less than
        /// <c>Burst - 1</c> refills ahead of now, and moves it a refill on from the later of itself
        /// and now: the bucket as one timestamp, so nothing about it is counted in fractions.
        /// </summary>
        public DateTimeOffset FullAt;

        public DateTimeOffset? SentAt;
        public EdgeInvalidation? Waiting;
        public ITimer? Timer;
    }

    private readonly IEdgeInvalidator inner;
    private readonly TimeProvider clock;
    private readonly ILogger<WithdrawalHold> logger;
    private readonly Pacing pacing;

    private readonly Dictionary<string, Account> accounts = new(StringComparer.Ordinal);
    private readonly Lock gate = new();
    private DateTimeOffset nextPrune;
    private bool stopped;

    public WithdrawalHold(IEdgeInvalidator inner, TimeProvider clock, ILogger<WithdrawalHold> logger)
        : this(inner, clock, logger, Pacing.Default)
    {
    }

    internal WithdrawalHold(IEdgeInvalidator inner, TimeProvider clock, ILogger<WithdrawalHold> logger, Pacing pacing)
    {
        this.inner = inner;
        this.clock = clock;
        this.logger = logger;
        this.pacing = pacing;
    }

    /// <summary>What the paced invalidations are handed to: CloudFront, or the logger.</summary>
    internal IEdgeInvalidator Inner => inner;

    public void Invalidate(EdgeInvalidation invalidation)
    {
        // Paths that are nobody's have no pace to keep.
        if (invalidation.Account is not { } id)
        {
            inner.Invalidate(invalidation);
            return;
        }

        EdgeInvalidation? send = null;
        TimeSpan? holdFor = null;

        lock (gate)
        {
            var now = clock.GetUtcNow();
            Prune(now);
            accounts.TryGetValue(id, out var account);

            if (invalidation.AtOnce || stopped)
            {
                // Whatever the account had waiting goes with it: sent after this write, it covers the
                // writes before it, and leaving it to go later would pay twice for one effect.
                send = account?.Waiting is { } waiting ? Merge(invalidation, waiting) : invalidation;
                if (account is not null) StopWaiting(account);
            }
            else
            {
                account ??= accounts[id] = new Account { FullAt = now };
                var stamped = invalidation with { WrittenAt = now };

                if (account.Waiting is { } waiting)
                {
                    account.Waiting = Merge(waiting, stamped);
                }
                else
                {
                    var at = NextSendAt(account);
                    if (at <= now)
                    {
                        Spend(account, now);
                        send = invalidation;
                    }
                    else
                    {
                        account.Waiting = stamped;
                        holdFor = at - now;
                        account.Timer = Schedule(id, at - now);
                    }
                }
            }
        }

        if (send is not null)
        {
            inner.Invalidate(send);
        }
        else if (holdFor is { } wait)
        {
            // Once per wait rather than per withdrawal, so a loop that is being paced cannot fill
            // the log as fast as it saves.
            logger.LogInformation(
                "Holding {Paths} ({Reason}) for {Wait}, the pace its account has left; whatever else it "
                + "withdraws meanwhile goes with it.",
                invalidation.PathsForLog, invalidation.Reason, wait);
        }
        else
        {
            logger.LogDebug(
                "{Paths} ({Reason}) goes with what its account already has waiting.",
                invalidation.PathsForLog, invalidation.Reason);
        }
    }

    /// <summary>
    /// Sends everything waiting at once, and passes everything after it straight through: the host is
    /// stopping, and the queue in front of CloudFront spends a few seconds sending what it holds.
    /// </summary>
    /// <remarks>
    /// Called on <see cref="IHostApplicationLifetime.ApplicationStopping"/>, which the host raises
    /// before it stops any hosted service, so this is in the queue before the queue's own drain.
    /// </remarks>
    internal void Flush()
    {
        List<EdgeInvalidation> waiting = [];

        lock (gate)
        {
            stopped = true;
            foreach (var account in accounts.Values)
            {
                if (account.Waiting is { } held) waiting.Add(held);
                StopWaiting(account);
            }
        }

        if (waiting.Count > 0)
        {
            logger.LogInformation(
                "Stopping: sending {Count} withdrawal(s) that were waiting for their account's pace now.",
                waiting.Count);
        }

        foreach (var held in waiting) Pass(held);
    }

    public void Dispose()
    {
        lock (gate)
        {
            foreach (var account in accounts.Values) account.Timer?.Dispose();
        }
    }

    /// <summary>The account's waiting invalidation, sent once its pace allows.</summary>
    private void Release(object? state)
    {
        var id = (string)state!;
        EdgeInvalidation? send;

        lock (gate)
        {
            if (!accounts.TryGetValue(id, out var account) || account.Waiting is not { } waiting) return;

            account.Timer?.Dispose();
            account.Timer = null;

            var now = clock.GetUtcNow();
            var at = NextSendAt(account);
            if (at > now)
            {
                // A timer may fire a little early; the pace is the bucket's, not the timer's.
                account.Timer = Schedule(id, at - now);
                return;
            }

            Spend(account, now);
            account.Waiting = null;
            send = waiting;
        }

        Pass(send);
    }

    /// <summary>
    /// Hands on an invalidation from a timer or the stop, where nothing above would catch what the
    /// invalidator throws: an exception escaping a timer's callback ends the process.
    /// </summary>
    private void Pass(EdgeInvalidation invalidation)
    {
        try
        {
            inner.Invalidate(invalidation);
        }
        catch (Exception e)
        {
            logger.LogError(e,
                "Could not hand {Paths} ({Reason}) to the edge invalidator after it waited for its account's pace; "
                + "they stay at the edge until their TTL runs out.",
                invalidation.PathsForLog, invalidation.Reason);
        }
    }

    /// <summary>The earliest the account may send again: its spacing, and its bucket.</summary>
    private DateTimeOffset NextSendAt(Account account)
    {
        var byBucket = account.FullAt - pacing.Refill * (pacing.Burst - 1);
        return account.SentAt is { } sent && sent + pacing.Spacing > byBucket ? sent + pacing.Spacing : byBucket;
    }

    private void Spend(Account account, DateTimeOffset now)
    {
        account.FullAt = (account.FullAt > now ? account.FullAt : now) + pacing.Refill;
        account.SentAt = now;
    }

    private static void StopWaiting(Account account)
    {
        account.Timer?.Dispose();
        account.Timer = null;
        account.Waiting = null;
    }

    private ITimer Schedule(string id, TimeSpan wait)
    {
        // Without the request's execution context: the timer outlives the request, and what it
        // sends is the account's, merged from several, not that one request's. Suppressing a flow
        // that is already suppressed throws, so that case is left as it is.
        if (ExecutionContext.IsFlowSuppressed())
            return clock.CreateTimer(Release, id, wait, Timeout.InfiniteTimeSpan);

        using (ExecutionContext.SuppressFlow())
            return clock.CreateTimer(Release, id, wait, Timeout.InfiniteTimeSpan);
    }

    /// <summary>
    /// Forgets the accounts that are back where an account with no history starts: nothing waiting,
    /// the bucket full and the spacing passed. At most once a refill, so a withdrawal does not walk
    /// the whole table.
    /// </summary>
    private void Prune(DateTimeOffset now)
    {
        if (now < nextPrune) return;
        nextPrune = now + pacing.Refill;

        foreach (var (id, account) in accounts)
        {
            if (account.Waiting is null
                && account.FullAt <= now
                && (account.SentAt is not { } sent || sent + pacing.Spacing <= now))
            {
                accounts.Remove(id);
            }
        }
    }

    /// <summary>
    /// One invalidation for both: every path either named, the first's first, and the later of the
    /// two writes, where a write with no time of its own is now and so the later.
    /// </summary>
    private static EdgeInvalidation Merge(EdgeInvalidation first, EdgeInvalidation second) =>
        new(
            string.Join(", ", first.Reason.Split(", ").Concat(second.Reason.Split(", ")).Distinct()),
            [.. first.Paths.Union(second.Paths, StringComparer.Ordinal)])
        {
            Account = first.Account,
            AtOnce = first.AtOnce,
            WrittenAt = first.WrittenAt is { } a && second.WrittenAt is { } b ? (a > b ? a : b) : null,
        };
}
