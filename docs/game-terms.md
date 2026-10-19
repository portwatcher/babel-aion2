# Game terminology

The Access-protected administrator page includes **游戏术语**. The catalog starts
empty. Enter vocabulary checked against the actual AION2 Global release; Babel
does not supply assumed names from another release or game.

## Editing the catalog

Each entry contains a source term, source language, alternative expressions,
game category, output-language expressions, short context, enabled state and
version. Use the same source language for the original term and its alternatives.
Supply a separate output expression for each canonical subtitle language code,
such as `zh-Hans`, `zh-Hant`, `ja` or `ko`. Simplified and Traditional Chinese are
separate entries in the output-expression list. A language code must identify a
language; `und` is reserved for uncertain recognition results.

| Field                                                 | Limit                                                  |
| ----------------------------------------------------- | ------------------------------------------------------ |
| Source term, each alternative, each output expression | 1–120 characters                                       |
| Source and output language codes                      | Canonical BCP 47, 2–35 characters                      |
| Alternatives                                          | At most 12, with no duplicate source/alternative names |
| Output expressions                                    | 1–24 distinct language codes                           |
| Category                                              | 1–80 characters                                        |
| Short context                                         | At most 400 characters                                 |
| Management request body                               | At most 32,768 bytes, including chunked input          |

Text is trimmed and NFC-normalized. Control/format characters are rejected.
Names are compared without letter case within the same canonical source language,
including alternatives, so two entries cannot give competing meanings to one
name. Nickname matching keeps its separate, case-sensitive rules.

Save an edit using the entry's current version. A concurrent edit receives 409
and preserves the accepted version. Every mutation advances a catalog revision;
that revision becomes the edited entry's version. Entry versions can skip
numbers. Deleting and recreating an ID therefore cannot make an old edit valid.
Disable an entry to retain it while excluding it from provider context. Deletion
removes its source, alternatives and output expressions.

The list contains 50 entries per page and searches source terms literally.
Paging carries the catalog revision; a concurrent catalog change returns 409
and requires reloading the first page. The catalog survives application restart.
Audit events contain the authenticated actor, entry ID, versions and enabled
state, without term text or short context. The public player API exposes none of
the private catalog.

## Applying terms to an audio sample

**使用已启用的游戏术语提示** is checked by default in the sample form. Uncheck it
to compare the same sample without terminology. Enabled terms go only to the
OpenAI original-caption recognizer as supported `prompt`, `keywords` and language
hints. The recognition context is independent of the output language.
Connection-only probes do not send this catalog.

`gpt-realtime-translate` consumes the same audio directly and does not support
custom prompts, glossaries or pronunciation guides. Target expressions remain
saved for manual evaluation; no unsupported translation context is sent. A
recognition hint cannot enforce how the separate translator renders a game term.
See [OpenAI's translation guide](https://developers.openai.com/cookbook/examples/voice_solutions/realtime_translation_guide).

Generated context has a conservative 6,000-byte UTF-8 budget per provider request.
More than 2,000 enabled entries also rejects the sample before provider work.
These are processing safeguards, not storage or measured capacity claims. Excess
context returns `CONTEXT_TOO_LARGE`; entries are never silently truncated. Disable
unneeded entries or compare without terms. Individual field limits alone do not
guarantee that the combined context fits.

The result shows the catalog revision and context entry counts. A catalog change
during processing makes the old request return 409. Editing terms in the same
page also clears its previous sample result. Sample audit metadata records the
catalog revision, not catalog content, audio or transcript text.

## API and validation

All routes require a verified Access assertion and its matching persisted
administrator session. Mutations require the configured same origin.

| Operation   | Request                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| List/search | `GET /api/management/terms?query=...&offset=0`                          |
| Next page   | Same GET with `offset` and `expectedVersion` from the prior page        |
| Create      | `PUT /api/management/terms/:uuid`, all fields plus `expectedVersion: 0` |
| Edit        | Same PUT with the entry's current positive `expectedVersion`            |
| Delete      | `DELETE /api/management/terms/:uuid`, current `expectedVersion`         |

Migration 0005 adds the catalog and entry tables. Only an empty catalog revision
row is initialized; no game terms, output languages or provider credentials are
seeded. `test:terms:db` exercises management and persistence; `test:samples:db`
checks context on actual loopback provider protocols and stale-result rejection.
Their vocabulary and provider output are synthetic fixtures.

Live terminology accuracy remains **NOT RUN** until authorized battle samples
are compared with reliable references for each output language. Check negation,
direction, target, team, quantity, countdown, actions and corrections separately.
The shared live pipeline and language administration are implemented; representative battle terminology still requires validation.
