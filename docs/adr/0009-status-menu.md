# ADR-0009: One status button holds the daemon, agents and models

Status: Accepted, 27 Oct 2026. Specs: R-007 Req 2, R-011 Req 6, R-050.

## Context
The top bar showed a chip per ready agent, one for the agents that are off, a chip per model and a credits line. At 1600 px the last chip was cut in half; any setup with more agents or models would cut more.

## Decision
The bar shows this week's spend and one button that summarises readiness ("Replay daemon, 2 agents, 4 models"). Its panel lists the daemon, ready agents, agents that cannot run and why, agents you can turn on and how, models with their roles and hosts, local models in no route yet, and credits left. It closes on Escape and on a click outside.

## Consequences
- The bar fits from phone width up, with any number of agents and models.
- Detail that used to live in tooltips is reachable by keyboard.
