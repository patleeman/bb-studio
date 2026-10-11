## Native mini-apps your agents write

Ask an agent for a small desktop tool, such as a HUD of your running threads, and it writes an applet: a folder with a manifest and some HTML and JavaScript. The signed Studio Applets app for macOS runs it. No build and no code signing per applet.

## You approve what each applet can do

An applet can't run commands or read your files. It asks for capabilities, such as an always-on-top window, a global shortcut, or reading your threads, and waits until you approve them in this plugin's settings.

## Experimental

The app that runs applets is still being built. Until then, agents can create and check applets, and settings shows each one's capabilities.
