import { type NextRequest, NextResponse } from "next/server"

// In-memory storage for demo (use Redis/Database in production)
const rooms = new Map<
  string,
  {
    id: string
    hostId: string
    created: number
    messages: any[]
    lastActivity: number
  }
>()

// Clean up old rooms (older than 1 hour)
const cleanupRooms = () => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000
  for (const [roomId, room] of rooms.entries()) {
    if (room.lastActivity < oneHourAgo) {
      rooms.delete(roomId)
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const { action, roomId, message, userId } = await request.json()

    cleanupRooms()

    switch (action) {
      case "create":
        const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase()
        rooms.set(newRoomId, {
          id: newRoomId,
          hostId: userId,
          created: Date.now(),
          messages: [],
          lastActivity: Date.now(),
        })
        return NextResponse.json({ success: true, roomId: newRoomId })

      case "join":
        const room = rooms.get(roomId)
        if (!room) {
          return NextResponse.json({ success: false, error: "Room not found" })
        }
        room.lastActivity = Date.now()
        return NextResponse.json({ success: true, room })

      case "send":
        const targetRoom = rooms.get(roomId)
        if (!targetRoom) {
          return NextResponse.json({ success: false, error: "Room not found" })
        }

        const fullMessage = {
          ...message,
          timestamp: Date.now(),
          senderId: userId,
        }

        targetRoom.messages.push(fullMessage)
        targetRoom.lastActivity = Date.now()

        // Keep only last 50 messages
        if (targetRoom.messages.length > 50) {
          targetRoom.messages = targetRoom.messages.slice(-50)
        }

        return NextResponse.json({ success: true })

      case "poll":
        const pollRoom = rooms.get(roomId)
        if (!pollRoom) {
          return NextResponse.json({ success: false, error: "Room not found" })
        }

        const since = Number.parseInt(request.nextUrl.searchParams.get("since") || "0")
        const newMessages = pollRoom.messages.filter((msg) => msg.timestamp > since && msg.senderId !== userId)

        pollRoom.lastActivity = Date.now()
        return NextResponse.json({ success: true, messages: newMessages })

      default:
        return NextResponse.json({ success: false, error: "Invalid action" })
    }
  } catch (error) {
    console.error("API Error:", error)
    return NextResponse.json({ success: false, error: "Server error" })
  }
}

export async function GET(request: NextRequest) {
  const roomId = request.nextUrl.searchParams.get("roomId")
  const userId = request.nextUrl.searchParams.get("userId")
  const since = Number.parseInt(request.nextUrl.searchParams.get("since") || "0")

  if (!roomId || !userId) {
    return NextResponse.json({ success: false, error: "Missing parameters" })
  }

  cleanupRooms()

  const room = rooms.get(roomId)
  if (!room) {
    return NextResponse.json({ success: false, error: "Room not found" })
  }

  const newMessages = room.messages.filter((msg) => msg.timestamp > since && msg.senderId !== userId)

  room.lastActivity = Date.now()
  return NextResponse.json({ success: true, messages: newMessages })
}
