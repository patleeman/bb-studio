// A thread a host restart cut off, then resumed by Studio (src/thread-resume.ts).
// Staging it takes a real daemon restart: start a long turn in a staged BB,
// kill that instance's host daemon (its launcher restarts it), and pass the
// thread as BB_CAPTURE_RESUME_THREAD_ID. Without one, there's nothing to capture.
export default ({ projectId }) => {
  const threadId = process.env.BB_CAPTURE_RESUME_THREAD_ID;
  if (!threadId) return [];
  return [
    {
      id: "studio-thread-resume",
      packageDir: "bb-studio",
      fileName: "thread-resume.png",
      privateSidebar: true,
      setup: async (client) => {
        await client.navigate(`/projects/${projectId}/threads/${threadId}`);
        await client.waitForText("Thread interrupted because the host daemon disconnected");
        await client.waitForText("↻ Resumed after a restart");
      },
    },
  ];
};
