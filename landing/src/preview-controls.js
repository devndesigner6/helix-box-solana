export function youtubePreviewUrl(videoId, reducedMotion) {
  const url = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
  url.search = new URLSearchParams({autoplay: reducedMotion ? '0' : '1', mute: '1', playsinline: '1', controls: '1', rel: '0', loop: '1', playlist: videoId}).toString();
  return url.href;
}

export function loadYoutubePreview(cover) {
  const frame = cover.ownerDocument.createElement('iframe');
  const source = new URL(youtubePreviewUrl(cover.dataset.demoVideo, false));
  source.searchParams.set('mute', '0');
  frame.src = source.href;
  frame.title = 'HelixBox Solana demo: mobile coding agents and x402 payments';
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.tabIndex = 0;
  cover.replaceWith(frame);
  frame.focus();
  return frame;
}

export async function togglePreview(video, onError = () => {}) {
  if (!video) return false;
  if (!video.paused) {
    video.pause();
    return false;
  }
  try {
    await video.play();
    return !video.paused;
  } catch (error) {
    onError(error);
    return false;
  }
}
