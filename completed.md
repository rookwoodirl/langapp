## IGNORE THIS FILE UNLESS EXPLICITLY ASKED TO UNDERSTAND PAST TASKS

TODO: Add language of the article as an environment variable when viewing the article to have on hand when doing vocab selection. If Chinese, just select 1 character at a time instead of the whole non-space-delimited block (there are no spaces in chinese usually so it's selecting the whole text block)

TODO: add language selection filtering for vocab section

TODO: Since some languages don't have conjugations or gender (chinese), add if/then statement for "give me gender" in vocab generation prompt based on target language (ex: if language in GENDERED_LANGUAGES prompt.add(gender_prompt))

TODO: add dark mode (bless)

TODO: move cost analysis to its own section (add filters for time + language)

TODO: remove audio generation confirm dialog and make "Generate audio" straight into "read audio" (no longer costs money)

TODO: remove anthropic key from settings because we're just using one on the backend

TODO: add a "Disclaimers" section in settings that explitly states vocab translations are given freely by Wiktionary under whatever license Wiktionary is under. Also mention that this application makes no promise of verified information or 100% accurate translations, just the convenience of translation through popular LLM providers

TODO: allow users to edit notecards + search for notecards by keyword and language

TODO: add "read aloud" to notecards using on-device TTS