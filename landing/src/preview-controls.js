export function youtubePreviewUrl(videoId, reducedMotion) {
  const url = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
  url.search = new URLSearchParams({autoplay: reducedMotion ? '0' : '1', mute: '1', playsinline: '1', controls: '1', rel: '0', loop: '1', playlist: videoId}).toString();
  return url.href;
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
