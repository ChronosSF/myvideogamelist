import { useEffect, useRef, useState } from 'react';

interface TrailerPlayerProps {
    /** The YouTube video's id. */
    videoId: string;
    /** The game's, for the player's title. */
    title: string;
    /** The game's own art, from IGDB, to stand in for the player until it is asked for. */
    poster: string | null;
}

/**
 * A game's trailer, loaded only when somebody asks for it.
 *
 * Until the press nothing comes from YouTube: not the player, and not its thumbnail either, since
 * fetching one from YouTube's image host is a request to Google too. The stand-in is the game's own
 * art, which the page already loads from IGDB. YouTube does not say what even its privacy-enhanced
 * player keeps in the visitor's browser, and a player loaded only on request needs no consent banner
 * to ask first. The press starts it playing, so it is still one press to watch.
 */
export function TrailerPlayer({ videoId, title, poster }: TrailerPlayerProps) {
    const [playing, setPlaying] = useState(false);
    const player = useRef<HTMLIFrameElement>(null);

    // The button that had the focus is gone once pressed: the player in its place takes it.
    useEffect(() => {
        if (playing) player.current?.focus();
    }, [playing]);

    return (
        <div className="game-page-trailer-embed">
            {playing ? (
                <iframe
                    ref={player}
                    src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1`}
                    title={`${title} trailer`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                />
            ) : (
                <button
                    type="button"
                    onClick={() => setPlaying(true)}
                    className="group absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface text-fg-strong cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                >
                    {poster !== null && (
                        <img src={poster} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                    )}
                    <span className="absolute inset-0 bg-black/50 group-hover:bg-black/40 transition-colors" aria-hidden="true" />
                    <span className="relative flex items-center justify-center w-16 h-16 rounded-full bg-primary-600 group-hover:bg-primary-500 text-on-primary shadow-lg transition-colors" aria-hidden="true">
                        <svg className="w-7 h-7 ml-1" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.29-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z" />
                        </svg>
                    </span>
                    <span className="relative text-sm font-semibold">Play trailer</span>
                    <span className="relative text-xs text-fg-soft">Loads from YouTube</span>
                </button>
            )}
        </div>
    );
}
