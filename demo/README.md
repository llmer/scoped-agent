# demo

`scoped-agent.cast` — an [asciinema](https://asciinema.org) recording of `run-demo.sh`:
a coding agent fixing a test inside its granted scope, then getting blocked when it
reaches outside the sandbox, with the full access log printed at the end.

Play it: `asciinema play scoped-agent.cast`
Regenerate: `asciinema rec --overwrite --idle-time-limit 2 --command "bash ../run-demo.sh" scoped-agent.cast`
