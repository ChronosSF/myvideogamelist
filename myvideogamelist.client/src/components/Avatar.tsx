import { useCallback, useState } from 'react';
import { avatarInitial, avatarSource } from '@/lib/avatar';
import './Avatar.css';

interface AvatarProps {
    /** The handle, whose initial is the picture when there is no other or it does not load. */
    userName: string;
    /** As the API stores it. Null, or an address the page would not load, shows the initial. */
    avatarUrl: string | null;
    /** The size and type, which the caller owns; the shape and the fallback's colours are here. */
    className?: string;
}

/**
 * An account's picture: its avatar when it has one that loads, and its handle's initial otherwise.
 *
 * Decorative wherever it appears, because a name is always beside it — so it is hidden from
 * assistive technology, and the image has an empty `alt`.
 *
 * The image is somebody else's server, so it is asked for as little as a picture can be (ADR 0056):
 * **no referrer**, so the host learns nothing of which page it is on; **lazily**, so a reader who
 * never scrolls to it never sends the request; and it is **never trusted to arrive**. A failure —
 * an address that 404s, a host that redirects somewhere the page's policy refuses, a picture since
 * deleted — puts the initial back.
 *
 * That has to hold for a failure before hydration too. The server renders the `<img>`, the browser
 * starts loading it at once, and an image that fails before React has attached `onError` fires its
 * error to nobody. So the image is also asked, once React has it, whether it already failed.
 */
export function Avatar({ userName, avatarUrl, className = '' }: AvatarProps) {
    const source = avatarSource(avatarUrl);

    // The address that failed, rather than a flag, so a new address gets a fresh chance without a
    // reset: saving another picture on the settings page shows that one.
    const [failed, setFailed] = useState<string | null>(null);
    const showImage = source !== null && failed !== source;

    const askIfAlreadyFailed = useCallback((image: HTMLImageElement | null) => {
        // Complete with no width is a broken image. Still loading is not complete, and is left to
        // `onError`, which is listening by now.
        if (image !== null && image.complete && image.naturalWidth === 0) {
            setFailed(image.getAttribute('src'));
        }
    }, []);

    return (
        <span className={`avatar ${className}`.trim()} aria-hidden="true">
            {showImage ? (
                <img
                    ref={askIfAlreadyFailed}
                    src={source}
                    alt=""
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                    onError={() => setFailed(source)}
                />
            ) : (
                avatarInitial(userName)
            )}
        </span>
    );
}
