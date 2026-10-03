# Retained upstream source

The Navigation server entry originated from BB commit
`0baa605b32a00619c1d7e3f32be6553ebcf8244a` (`plugins/navigation`).

The vendored UI and its refresh scripts were removed after the Office sidebar
replaced both slot registrations. Preserve the server and preference migration
when updating the retained module.
