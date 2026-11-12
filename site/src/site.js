// Plays the scene clips only while they are on screen, and never under
// reduced motion. Each clip keeps its poster and controls otherwise.
(() => {
  const clips = document.querySelectorAll("video[data-clip]");
  if (!clips.length || !("IntersectionObserver" in window)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const video = entry.target;
      if (entry.isIntersecting) {
        video.preload = "auto";
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }
  }, { threshold: 0.4 });
  clips.forEach((video) => seen.observe(video));
})();
