import type { Socket } from "socket.io"

/**
 * In-memory registry mapping user IDs to their connected sockets.
 *
 * Sockets are tied to the running server instance, so this map is always
 * consistent - connect/disconnect events update it, and lookups are O(1).
 *
 * A user may have multiple sockets (multiple tabs, devices, etc).
 */
export class UserSocketRegistry {
  private userSockets = new Map<string, Set<Socket>>()

  register(userId: string, socket: Socket): void {
    let sockets = this.userSockets.get(userId)
    if (!sockets) {
      sockets = new Set()
      this.userSockets.set(userId, sockets)
    }
    sockets.add(socket)
  }

  unregister(userId: string, socket: Socket): void {
    const sockets = this.userSockets.get(userId)
    if (sockets) {
      sockets.delete(socket)
      if (sockets.size === 0) {
        this.userSockets.delete(userId)
      }
    }
  }

  getSockets(userId: string): Socket[] {
    const sockets = this.userSockets.get(userId)
    return sockets ? Array.from(sockets) : []
  }
}
