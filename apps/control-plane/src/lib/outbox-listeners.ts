/**
 * The control plane uses a single outbox listener for every event type
 * (workspace provisioning, KV sync, authz fan-out). Centralising the id here
 * lets surfaces that need to inspect listener state — e.g. the backoffice
 * outbox-status endpoint — share the same constant as the bootstrap that
 * registers the listener.
 */
export const CONTROL_PLANE_LISTENER_ID = "control-plane"
