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

// Download: "Coming soon" until GitHub has a published release. Drafts and
// prereleases never show: /releases/latest returns only a published, full
// release (404 otherwise). Any failure leaves "Coming soon".
(() => {
  const status = document.querySelector("[data-release-status]");
  const link = document.querySelector("[data-release-link]");
  if (!status || !link || !window.fetch) return;
  fetch("https://api.github.com/repos/patleeman/bb-studio/releases/latest", { headers: { Accept: "application/vnd.github+json" } })
    .then((response) => (response.ok ? response.json() : null))
    .then((release) => {
      if (!release || release.draft || release.prerelease || typeof release.html_url !== "string") return;
      if (!release.html_url.startsWith("https://github.com/patleeman/bb-studio/releases/")) return;
      const anchor = link.querySelector("a");
      const dmg = (release.assets || []).find((asset) => /\.dmg$/i.test(asset.name || ""));
      anchor.href = dmg && typeof dmg.browser_download_url === "string" && dmg.browser_download_url.startsWith("https://github.com/patleeman/bb-studio/releases/download/") ? dmg.browser_download_url : release.html_url;
      link.querySelector("[data-release-name]").textContent = `BB Studio ${release.name || release.tag_name}`;
      link.hidden = false;
      status.hidden = true;
    })
    .catch(() => {});
})();
