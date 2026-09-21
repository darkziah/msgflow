# Collision detection: draft-open signal, soft-warn

Collision is signaled by draft-open presence, not keystroke typing: the client sends `draft:opened` / `draft:closed` events, and the DO tracks who has a draft open in its presence state and broadcasts to viewers. Keystroke "typing" is a separate, transient indicator.

Collision soft-warns ("Agent X is replying") rather than hard-blocking the composer — a hard lock creates stuck states when a browser dies without sending `draft:closed`. The draft-open state rides the persisted presence from ADR 0007 (survives hibernation, rehydrates on wake).
