# Providers and output languages

## Initial state

There are no available provider adapters and no enabled output languages.
The public API returns an empty list. No provider credential or private setting
is exposed. The administrator page accurately reports that setup is unavailable
until the adapter and settings implementation exists.

The database already has versioned provider configurations and disabled-by-default
language rows. Credential fields are reserved for ciphertext. Encryption,
configuration forms, tests, validation, hot replacement, and rollback are not
implemented yet; do not put a plain-text key in that column.

## Implementation requirements

Compare current documented APIs and measured results before selecting providers.
An adapter must implement its advertised recognition/translation function. Real
connection tests must use allowed service destinations and distinguish invalid
credentials, model availability, and quota faults. Do not offer unfinished
providers, fabricate multi-language parameters, or allow player-defined endpoints.

Store the protected encryption key separately from dynamic ciphertext through
the infra secret mechanism. API responses and exports must contain only masked
credential information. Audit identities, resource IDs, and versions rather than
request bodies. Keep a valid previous configuration if a change fails.

Use BCP 47 website codes independently from provider parameters. Enable a language
only after its complete processing path is validated. Start shared work when
players subscribe and release unused work after a short delay. A translation
fault must not stop original audio or silently switch language.

## Selection contract already implemented

`selectOutputLanguage` selects a valid saved code first, then browser preferences
in order, then the configured default, then the first enabled language, then
`null`. It canonicalizes codes, tries an exact match, and matches a language only
when its writing system is compatible. The tests include `ja-JP` → `ja`, `ko-KR`
→ `ko`, and `zh-CN` → `zh-Hans`. Traditional and Simplified Chinese remain distinct.

The future player session implementation must supply `navigator.languages`, or
`navigator.language` if the list is unavailable. It must persist explicit choices,
validate selections on the server, fence delayed subtitle results, and update
the main page and PiP without replacing the listener session or audio connection.

## Enabling Chinese, Japanese, and Korean later

After provider management is implemented and deployed, the administrator will
save valid provider settings, test each required path, add `zh-Hans`, `ja`, and
`ko`, set their order and default, and enable the validated paths. These choices
are not seeded by this scaffold. The present version has no settings form that
can enable them. Configuration after deployment must eventually need no code change.
