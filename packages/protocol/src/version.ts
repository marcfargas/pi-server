/**
 * Pi-Server Wire Protocol — Version
 *
 * Bump PROTOCOL_VERSION when:
 * - Message structure changes (fields added/removed/renamed)
 * - New required fields in handshake
 * - Behavioral changes in message semantics
 *
 * Do NOT bump for:
 * - New optional fields (additive, backwards-compatible)
 * - New event types from pi (we relay them as-is)
 * - Server-internal changes
 */

export const PROTOCOL_VERSION = 1;
