# Retained upstream source

The Sidebar server and shared preference definitions originated from BB commit
`8595b6ea4b8bfa771f84d57e69124e76bacf9eef` (`plugins/thread-list`).
Studio adds preference definitions and tests for its stored layout settings.

The vendored UI and its refresh scripts were removed after the Office sidebar
replaced both slot registrations. Preserve the server and preference migration
when updating the retained module.
