# Strudel

This [webxdc](https://webxdc.org/) wraps [strudel.cc](https://strudel.cc/) and syncs the code between peers. The fastest way to use this is to send the app.xdc asset from releases into a chat in [Delta Chat](https://delta.chat).

A compact drum kit (`bd`, `sd`, `hh`, `oh`, and `cp`) is bundled at build time so these samples work offline.

# Getting started

```sh
# Install dependencies
pnpm install
# Perform code checks
pnpm run check
# Start the webxdc emulator
pnpm run emulator
# Build the application for distribution
pnpm run build
```

Do not use this with a tool like https://github.com/kajuwise/spotify-dl-on-steroids because listening to the music you pay for might be illegal.

# TODO

- attach sounds that would be synced to peers automatically

# LLM disclaimer

I've used an LLM to generate much of the code in this repo. The justification for this is that webxdc's are sandboxed and cannot access the internet or any of the systems they run on which means it is basically impossible to create vulnerabilities. This makes webxdcs a nice playground for LLMs where they can't do any harm while quickly delivering new features to end users. I do not suggest using LLMs in the manner I did in this repo for non-sandboxed applications.
