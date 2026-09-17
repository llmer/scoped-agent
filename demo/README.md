# demo

`scoped-agent.cast` — a terminal recording of `run-demo.sh`: a coding agent fixing a
test inside its granted scope, then getting blocked when it reaches outside the
sandbox, with the access log printed after each run.

Play it: `asciinema play scoped-agent.cast`

Regenerate the cast (curated, terminal-styled — one line per run, bold allow/deny log):
```
node regen-cast.mjs
```

Render the GIF for the README / X (larger font reads better in-timeline):
```
agg --font-size 20 --theme monokai scoped-agent.cast scoped-agent.gif
```
