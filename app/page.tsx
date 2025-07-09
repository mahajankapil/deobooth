"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Camera, Phone, PhoneOff, Copy, Users } from "lucide-react"

type FilterType = "90s" | "2000s" | "Noir" | "Fisheye" | "Rainbow" | "Glitch" | "Crosshatch"
type AppMode = "solo" | "duo"

interface CapturedPhoto {
  dataUrl: string
  timestamp: number
}

interface SignalingMessage {
  type: "offer" | "answer" | "ice-candidate" | "filter-change" | "photo-sync" | "join-room" | "room-created"
  data: any
  roomId: string
  senderId: string
  timestamp: number
}

export default function PhotoBoothApp() {
  const [appMode, setAppMode] = useState<AppMode>("solo")
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [countdown, setCountdown] = useState<string | null>(null)
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([])
  const [currentFilter, setCurrentFilter] = useState<FilterType>("2000s")
  const [showPhotoStrip, setShowPhotoStrip] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [showCurtains, setShowCurtains] = useState(true)
  const [curtainsAnimating, setCurtainsAnimating] = useState(false)

  // Duo mode states
  const [roomId, setRoomId] = useState("")
  const [isConnected, setIsConnected] = useState(false)
  const [isHost, setIsHost] = useState(false)
  const [callDuration, setCallDuration] = useState(0)
  const [peerConnection, setPeerConnection] = useState<RTCPeerConnection | null>(null)
  const [remoteFilter, setRemoteFilter] = useState<FilterType>("2000s")
  const [showRoomSetup, setShowRoomSetup] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<string>("Disconnected")
  const [userId] = useState(() => Math.random().toString(36).substring(2, 15))
  const [isWaitingForPeer, setIsWaitingForPeer] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const photoStripCanvasRef = useRef<HTMLCanvasElement>(null)
  const callTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastProcessedTimestamp = useRef<number>(0)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const availableFilters: { name: FilterType; label: string; css: string }[] = [
    { name: "90s", label: "90s", css: "sepia(0.8) saturate(1.4) hue-rotate(315deg) brightness(1.1)" },
    { name: "2000s", label: "2000s", css: "saturate(1.6) contrast(1.2) brightness(1.1) hue-rotate(10deg)" },
    { name: "Noir", label: "Noir", css: "grayscale(1) contrast(1.3) brightness(0.9)" },
    { name: "Fisheye", label: "Fisheye", css: "contrast(1.2) saturate(1.3)" },
    { name: "Rainbow", label: "Rainbow", css: "hue-rotate(180deg) saturate(2) brightness(1.2)" },
    { name: "Glitch", label: "Glitch", css: "hue-rotate(90deg) saturate(2) contrast(1.5)" },
    { name: "Crosshatch", label: "Crosshatch", css: "contrast(1.4) brightness(0.8) saturate(0.8)" },
  ]

  const backgroundClouds = [
    { width: 80, height: 50, left: 10, top: 15 },
    { width: 120, height: 70, left: 25, top: 8 },
    { width: 90, height: 55, left: 45, top: 20 },
    { width: 110, height: 65, left: 65, top: 12 },
    { width: 85, height: 45, left: 80, top: 25 },
    { width: 95, height: 60, left: 15, top: 45 },
    { width: 130, height: 75, left: 35, top: 40 },
    { width: 75, height: 40, left: 55, top: 50 },
    { width: 100, height: 55, left: 75, top: 35 },
    { width: 115, height: 70, left: 5, top: 70 },
    { width: 90, height: 50, left: 30, top: 75 },
    { width: 105, height: 65, left: 50, top: 80 },
    { width: 80, height: 45, left: 70, top: 65 },
    { width: 125, height: 80, left: 85, top: 75 },
  ]

  const formatCallDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  const startCallTimer = () => {
    callTimerRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1)
    }, 1000)
  }

  const stopCallTimer = () => {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current)
      callTimerRef.current = null
    }
  }

  // Server-based signaling using API routes
  const sendSignalingMessage = async (message: Omit<SignalingMessage, "senderId" | "timestamp">) => {
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          roomId: message.roomId,
          message: {
            type: message.type,
            data: message.data,
            roomId: message.roomId,
          },
          userId,
        }),
      })

      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || "Failed to send message")
      }

      console.log(`Sent ${message.type} message for room ${message.roomId}`)
    } catch (error) {
      console.error("Error sending signaling message:", error)
      throw error
    }
  }

  const pollForMessages = useCallback(async () => {
    if (!roomId) return

    try {
      const response = await fetch(
        `/api/rooms?roomId=${roomId}&userId=${userId}&since=${lastProcessedTimestamp.current}`,
      )
      const result = await response.json()

      if (result.success && result.messages.length > 0) {
        for (const message of result.messages) {
          lastProcessedTimestamp.current = Math.max(lastProcessedTimestamp.current, message.timestamp)

          try {
            switch (message.type) {
              case "join-room":
                if (isHost && !isConnected && peerConnection) {
                  setConnectionStatus("Friend joined! Creating connection...")
                  const offer = await peerConnection.createOffer()
                  await peerConnection.setLocalDescription(offer)
                  await sendSignalingMessage({
                    type: "offer",
                    data: offer,
                    roomId: roomId,
                  })
                }
                break

              case "offer":
                if (peerConnection) {
                  setConnectionStatus("Received connection offer...")
                  await peerConnection.setRemoteDescription(new RTCSessionDescription(message.data))
                  const answer = await peerConnection.createAnswer()
                  await peerConnection.setLocalDescription(answer)
                  await sendSignalingMessage({
                    type: "answer",
                    data: answer,
                    roomId: roomId,
                  })
                  setConnectionStatus("Sent connection response...")
                }
                break

              case "answer":
                if (peerConnection) {
                  setConnectionStatus("Connection established!")
                  await peerConnection.setRemoteDescription(new RTCSessionDescription(message.data))
                }
                break

              case "ice-candidate":
                if (peerConnection) {
                  await peerConnection.addIceCandidate(new RTCIceCandidate(message.data))
                }
                break

              case "filter-change":
                setRemoteFilter(message.data.filter)
                break
            }
          } catch (error) {
            console.error("Error processing message:", message.type, error)
          }
        }
      }
    } catch (error) {
      console.error("Error polling for messages:", error)
    }
  }, [roomId, userId, isHost, isConnected, peerConnection])

  // Start polling when room is active
  useEffect(() => {
    if (roomId && peerConnection) {
      pollingIntervalRef.current = setInterval(pollForMessages, 1000)
      return () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current)
        }
      }
    }
  }, [roomId, peerConnection, pollForMessages])

  const createRoom = async () => {
    setConnectionStatus("Creating room...")
    setIsLoading(true)

    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          userId,
        }),
      })

      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || "Failed to create room")
      }

      const newRoomId = result.roomId
      setRoomId(newRoomId)
      setIsHost(true)
      setConnectionStatus("Room created! Share the Room ID with your friend.")

      await initializeWebRTC(true, newRoomId)

      // Host goes directly to meeting interface
      setShowRoomSetup(false)
      setIsWaitingForPeer(true)
    } catch (error) {
      console.error("Error creating room:", error)
      setConnectionStatus("Failed to create room")
      alert(`Failed to create room: ${error instanceof Error ? error.message : "Unknown error"}`)
      setIsLoading(false)
    }
  }

  const joinRoom = async (id: string) => {
    if (!id.trim()) {
      alert("Please enter a valid Room ID")
      return
    }

    const targetRoomId = id.trim().toUpperCase()
    setConnectionStatus("Looking for room...")
    setIsLoading(true)

    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "join",
          roomId: targetRoomId,
          userId,
        }),
      })

      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || "Room not found")
      }

      setRoomId(targetRoomId)
      setIsHost(false)
      setConnectionStatus("Room found! Joining...")

      await initializeWebRTC(false, targetRoomId)

      // Send join room message
      await sendSignalingMessage({
        type: "join-room",
        data: { joinerId: userId, joined: Date.now() },
        roomId: targetRoomId,
      })

      // Joiner goes to meeting interface
      setShowRoomSetup(false)
    } catch (error) {
      console.error("Error joining room:", error)
      setConnectionStatus("Failed to join room")
      alert(
        `Room not found! Please check the Room ID and make sure your friend has created the room.\n\nError: ${error instanceof Error ? error.message : "Unknown error"}`,
      )
      setIsLoading(false)
    }
  }

  const initializeWebRTC = async (isHostUser: boolean, targetRoomId: string) => {
    try {
      setConnectionStatus("Requesting camera access...")

      const localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
        },
        audio: true,
      })

      setStream(localStream)

      if (videoRef.current) {
        videoRef.current.srcObject = localStream
      }

      setConnectionStatus("Setting up connection...")

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
        ],
      })

      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream)
      })

      pc.ontrack = (event) => {
        const [remoteStream] = event.streams
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream
        }
        setIsConnected(true)
        setIsWaitingForPeer(false)
        setConnectionStatus("Connected!")
        startCallTimer()
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignalingMessage({
            type: "ice-candidate",
            data: event.candidate,
            roomId: targetRoomId,
          })
        }
      }

      pc.onconnectionstatechange = () => {
        console.log("Connection state:", pc.connectionState)
        if (pc.connectionState === "connected") {
          setConnectionStatus("Connected!")
        } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          setConnectionStatus("Connection lost")
          setIsConnected(false)
        }
      }

      setPeerConnection(pc)
      setIsLoading(false)
    } catch (error) {
      console.error("WebRTC initialization error:", error)
      setIsLoading(false)
      setConnectionStatus("Connection failed")
      alert(
        `Connection Error: ${error instanceof Error ? error.message : "Unknown error"}\n\nPlease check your camera permissions and try again.`,
      )
    }
  }

  const endCall = () => {
    if (peerConnection) {
      peerConnection.close()
    }

    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
    }

    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
    }

    stopCallTimer()
    setIsConnected(false)
    setCallDuration(0)
    setPeerConnection(null)
    setShowRoomSetup(false)
    setAppMode("solo")
    setShowCurtains(true)
    setConnectionStatus("Disconnected")
    setIsWaitingForPeer(false)
    setRoomId("")
  }

  const handleFilterChange = (filter: FilterType) => {
    setCurrentFilter(filter)

    // Send filter change to peer
    if (isConnected && roomId) {
      sendSignalingMessage({
        type: "filter-change",
        data: { filter },
        roomId: roomId,
      })
    }
  }

  const initializePhotoBooth = async () => {
    setCurtainsAnimating(true)
    setTimeout(() => {
      setShowCurtains(false)
      if (appMode === "solo") {
        requestCameraAccess()
      } else {
        setShowRoomSetup(true)
        setIsLoading(false)
      }
    }, 2000)
  }

  const requestCameraAccess = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera not supported by this browser")
      }

      const cameraConfigs = [
        {
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "user",
          },
          audio: false,
        },
        {
          video: true,
          audio: false,
        },
      ]

      let mediaStream = null
      let lastError = null

      for (const config of cameraConfigs) {
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia(config)
          break
        } catch (error) {
          lastError = error
          continue
        }
      }

      if (!mediaStream) {
        throw lastError || new Error("Could not access camera")
      }

      setStream(mediaStream)

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream
        await new Promise((resolve, reject) => {
          if (!videoRef.current) {
            reject(new Error("Video element not found"))
            return
          }

          videoRef.current.onloadedmetadata = () => {
            if (videoRef.current) {
              videoRef.current
                .play()
                .then(() => resolve(true))
                .catch(reject)
            }
          }

          setTimeout(() => {
            reject(new Error("Video loading timeout"))
          }, 10000)
        })
      }

      setIsLoading(false)
    } catch (error) {
      setIsLoading(false)
      const errorMessage = error instanceof Error ? error.message : "Unknown camera error"
      alert(`Camera Error: ${errorMessage}\n\nPlease allow camera permissions and try again.`)
    }
  }, [])

  const captureCurrentFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return null

    const canvas = canvasRef.current
    const video = videoRef.current
    const context = canvas.getContext("2d")

    if (!context) return null

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const selectedFilter = availableFilters.find((f) => f.name === currentFilter)?.css || ""
    context.filter = selectedFilter

    context.save()
    context.scale(-1, 1)
    context.drawImage(video, -canvas.width, 0)
    context.restore()

    context.filter = "none"

    return canvas.toDataURL("image/jpeg", 0.9)
  }, [currentFilter, availableFilters])

  const handlePhotoCapture = useCallback(async () => {
    if (isCapturing || capturedPhotos.length >= 3) return

    setIsCapturing(true)

    const countdownSequence = ["3...", "2...", "1...", "Smile..."]

    for (let i = 0; i < countdownSequence.length; i++) {
      setCountdown(countdownSequence[i])
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    setCountdown(null)

    const photoData = captureCurrentFrame()
    if (photoData) {
      const newPhoto = {
        dataUrl: photoData,
        timestamp: Date.now(),
      }
      setCapturedPhotos((prevPhotos) => {
        const updatedPhotos = [...prevPhotos, newPhoto]
        if (updatedPhotos.length === 3) {
          setTimeout(() => setShowPhotoStrip(true), 500)
        }
        return updatedPhotos
      })
    }

    setIsCapturing(false)
  }, [isCapturing, capturedPhotos.length, captureCurrentFrame])

  const createPhotoStrip = useCallback(() => {
    if (!photoStripCanvasRef.current || capturedPhotos.length !== 3) return

    const canvas = photoStripCanvasRef.current
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const STRIP_WIDTH = 260
    const STRIP_HEIGHT = 650
    const PHOTO_WIDTH = 220
    const PHOTO_HEIGHT = 165
    const MARGIN = 20
    const PHOTO_SPACING = 20

    canvas.width = STRIP_WIDTH
    canvas.height = STRIP_HEIGHT

    const backgroundGradient = ctx.createLinearGradient(0, 0, 0, STRIP_HEIGHT)
    backgroundGradient.addColorStop(0, "#ffffff")
    backgroundGradient.addColorStop(1, "#f8f9fa")
    ctx.fillStyle = backgroundGradient
    ctx.fillRect(0, 0, STRIP_WIDTH, STRIP_HEIGHT)

    ctx.strokeStyle = "#e9ecef"
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, STRIP_WIDTH - 2, STRIP_HEIGHT - 2)

    let loadedCount = 0
    capturedPhotos.forEach((photo, index) => {
      const img = new Image()
      img.onload = () => {
        const yPosition = MARGIN + index * (PHOTO_HEIGHT + PHOTO_SPACING)

        ctx.shadowColor = "rgba(0,0,0,0.15)"
        ctx.shadowBlur = 8
        ctx.shadowOffsetX = 3
        ctx.shadowOffsetY = 3

        ctx.fillStyle = "#ffffff"
        ctx.fillRect(MARGIN - 5, yPosition - 5, PHOTO_WIDTH + 10, PHOTO_HEIGHT + 10)

        ctx.drawImage(img, MARGIN, yPosition, PHOTO_WIDTH, PHOTO_HEIGHT)

        ctx.shadowColor = "transparent"
        ctx.shadowBlur = 0
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 0

        ctx.strokeStyle = "#dee2e6"
        ctx.lineWidth = 1
        ctx.strokeRect(MARGIN, yPosition, PHOTO_WIDTH, PHOTO_HEIGHT)

        loadedCount++

        if (loadedCount === 3) {
          ctx.fillStyle = "#495057"
          ctx.font = "italic bold 18px Georgia, serif"
          ctx.textAlign = "center"
          const currentDate = new Date().toLocaleDateString("en-US", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })
          ctx.fillText(`📸College Wishlist • ${currentDate}`, STRIP_WIDTH / 2, STRIP_HEIGHT - 40)
        }
      }
      img.src = photo.dataUrl
    })
  }, [capturedPhotos])

  useEffect(() => {
    if (showPhotoStrip && capturedPhotos.length === 3) {
      setTimeout(createPhotoStrip, 100)
    }
  }, [showPhotoStrip, capturedPhotos, createPhotoStrip])

  const downloadStrip = () => {
    if (!photoStripCanvasRef.current) return

    const downloadLink = document.createElement("a")
    downloadLink.download = `college-wishlist-photos-${Date.now()}.jpg`
    downloadLink.href = photoStripCanvasRef.current.toDataURL("image/jpeg", 0.9)
    downloadLink.click()
  }

  const resetPhotoBooth = () => {
    setShowPhotoStrip(false)
    setCapturedPhotos([])
    setCountdown(null)
  }

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId)
    alert("Room ID copied to clipboard!")
  }

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
      stopCallTimer()
    }
  }, [stream])

  if (showCurtains) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-200 via-pink-200 to-orange-300 relative overflow-hidden">
        <div className="absolute inset-0 opacity-40">
          {backgroundClouds.map((cloud, index) => (
            <div
              key={index}
              className="absolute bg-white rounded-full"
              style={{
                width: cloud.width,
                height: cloud.height,
                left: `${cloud.left}%`,
                top: `${cloud.top}%`,
              }}
            />
          ))}
        </div>

        <div className="flex items-center justify-center min-h-screen relative">
          <div className="text-center z-20">
            <div className="bg-red-600 text-white px-8 py-4 rounded-full text-2xl font-bold mb-8 shadow-lg">
              Welcome To College Wishlist
            </div>

            <div className="flex gap-6 mb-8">
              <Button
                onClick={() => setAppMode("solo")}
                className={`px-6 py-3 rounded-lg font-bold transition-all ${
                  appMode === "solo" ? "bg-yellow-500 text-black" : "bg-white text-black hover:bg-yellow-100"
                }`}
              >
                <Camera className="w-5 h-5 mr-2" />
                Solo Booth
              </Button>
              <Button
                onClick={() => setAppMode("duo")}
                className={`px-6 py-3 rounded-lg font-bold transition-all ${
                  appMode === "duo" ? "bg-yellow-500 text-black" : "bg-white text-black hover:bg-yellow-100"
                }`}
              >
                <Users className="w-5 h-5 mr-2" />
                Duo Booth
              </Button>
            </div>

            <div
              className="bg-gradient-to-b from-red-600 to-red-700 w-64 h-64 mx-auto rounded-lg flex items-center justify-center shadow-xl cursor-pointer hover:scale-105 transition-transform duration-200"
              onClick={initializePhotoBooth}
            >
              <div className="text-yellow-400 text-sm font-bold text-center leading-tight">
                INSERT
                <br />
                COIN HERE
              </div>
            </div>
          </div>

          <div className="absolute inset-0 z-10 pointer-events-none">
            <div
              className={`absolute top-0 left-0 w-1/2 h-full bg-gradient-to-r from-red-800 via-red-700 to-red-600 shadow-2xl transition-transform duration-2000 ease-in-out ${
                curtainsAnimating ? "-translate-x-full" : "translate-x-0"
              }`}
              style={{
                background: "repeating-linear-gradient(90deg, #991b1b 0px, #dc2626 20px, #b91c1c 40px)",
                boxShadow: "inset -20px 0 40px rgba(0,0,0,0.3), 20px 0 40px rgba(0,0,0,0.5)",
              }}
            >
              <div className="absolute inset-0 opacity-30">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="absolute top-0 h-full w-8 bg-gradient-to-r from-red-900 to-transparent"
                    style={{ left: `${i * 12.5}%` }}
                  />
                ))}
              </div>
            </div>

            <div
              className={`absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-red-800 via-red-700 to-red-600 shadow-2xl transition-transform duration-2000 ease-in-out ${
                curtainsAnimating ? "translate-x-full" : "translate-x-0"
              }`}
              style={{
                background: "repeating-linear-gradient(270deg, #991b1b 0px, #dc2626 20px, #b91c1c 40px)",
                boxShadow: "inset 20px 0 40px rgba(0,0,0,0.3), -20px 0 40px rgba(0,0,0,0.5)",
              }}
            >
              <div className="absolute inset-0 opacity-30">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="absolute top-0 h-full w-8 bg-gradient-to-l from-red-900 to-transparent"
                    style={{ right: `${i * 12.5}%` }}
                  />
                ))}
              </div>
            </div>

            <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-yellow-600 to-yellow-800 shadow-lg z-30">
              <div className="absolute inset-0 bg-gradient-to-r from-yellow-500 via-yellow-600 to-yellow-500 opacity-50"></div>
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute top-1 w-6 h-6 bg-yellow-700 rounded-full shadow-md"
                  style={{ left: `${8 + i * 8}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (showRoomSetup && appMode === "duo") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-200 via-pink-200 to-orange-300 relative overflow-hidden">
        <div className="absolute inset-0 opacity-40">
          {backgroundClouds.map((cloud, index) => (
            <div
              key={index}
              className="absolute bg-white rounded-full"
              style={{
                width: cloud.width,
                height: cloud.height,
                left: `${cloud.left}%`,
                top: `${cloud.top}%`,
              }}
            />
          ))}
        </div>

        <div className="flex items-center justify-center min-h-screen relative z-10">
          <Card className="bg-white p-8 rounded-3xl shadow-2xl max-w-md w-full">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Duo Photo Booth</h2>
              <p className="text-gray-600">Connect with a friend to take photos together!</p>
              {connectionStatus && (
                <p className="text-sm text-blue-600 mt-2 font-medium animate-pulse">{connectionStatus}</p>
              )}
            </div>

            <div className="space-y-4">
              <Button
                onClick={createRoom}
                disabled={isLoading}
                className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-bold disabled:opacity-50"
              >
                <Phone className="w-5 h-5 mr-2" />
                {isLoading ? "Creating..." : "Create Room"}
              </Button>

              <div className="text-center text-gray-500">or</div>

              <div className="space-y-2">
                <Input
                  placeholder="Enter Room ID"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  className="text-center font-mono text-lg"
                  disabled={isLoading}
                />
                <Button
                  onClick={() => joinRoom(roomId)}
                  disabled={!roomId || isLoading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-bold disabled:opacity-50"
                >
                  <Users className="w-5 h-5 mr-2" />
                  {isLoading ? "Joining..." : "Join Room"}
                </Button>
              </div>

              {roomId && isHost && !isConnected && (
                <div className="bg-gray-100 p-4 rounded-lg">
                  <p className="text-sm text-gray-600 mb-2">Share this Room ID with your friend:</p>
                  <div className="flex items-center gap-2">
                    <code className="bg-white px-3 py-2 rounded font-mono text-lg flex-1 text-center">{roomId}</code>
                    <Button onClick={copyRoomId} size="sm" className="bg-gray-600 hover:bg-gray-700">
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  {isWaitingForPeer && (
                    <p className="text-sm text-orange-600 mt-2 text-center animate-pulse">
                      Waiting for your friend to join...
                    </p>
                  )}
                </div>
              )}

              <Button
                onClick={() => {
                  setShowRoomSetup(false)
                  setShowCurtains(true)
                  setAppMode("solo")
                }}
                variant="outline"
                className="w-full"
              >
                Back to Main Menu
              </Button>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-200 via-pink-200 to-orange-300 relative overflow-hidden">
        <div className="absolute inset-0 opacity-40">
          {backgroundClouds.map((cloud, index) => (
            <div
              key={index}
              className="absolute bg-white rounded-full"
              style={{
                width: cloud.width,
                height: cloud.height,
                left: `${cloud.left}%`,
                top: `${cloud.top}%`,
              }}
            />
          ))}
        </div>

        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="bg-red-600 text-white px-8 py-4 rounded-full text-2xl font-bold mb-4 shadow-lg">
              Welcome To College Wishlist
            </div>
            <div className="text-white text-xl">
              {connectionStatus || (appMode === "duo" ? "Connecting to your friend..." : "Loading camera...")}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-200 via-pink-200 to-orange-300 relative overflow-hidden">
      <div className="absolute inset-0 opacity-40">
        {backgroundClouds.map((cloud, index) => (
          <div
            key={index}
            className="absolute bg-white rounded-full"
            style={{
              width: cloud.width,
              height: cloud.height,
              left: `${cloud.left}%`,
              top: `${cloud.top}%`,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 flex items-center justify-center min-h-screen p-4">
        {!showPhotoStrip ? (
          <div className="w-full max-w-6xl">
            {appMode === "duo" && (isConnected || (isHost && isWaitingForPeer)) ? (
              <div className="space-y-6">
                {/* Show room ID for host when waiting */}
                {isHost && isWaitingForPeer && !isConnected && (
                  <div className="text-center mb-4">
                    <div className="bg-white p-4 rounded-lg shadow-lg max-w-md mx-auto">
                      <p className="text-gray-700 mb-2">Share this Room ID with your friend:</p>
                      <div className="flex items-center gap-2">
                        <code className="bg-gray-100 px-3 py-2 rounded font-mono text-lg flex-1 text-center">
                          {roomId}
                        </code>
                        <Button onClick={copyRoomId} size="sm" className="bg-gray-600 hover:bg-gray-700">
                          <Copy className="w-4 h-4" />
                        </Button>
                      </div>
                      <p className="text-sm text-orange-600 mt-2 animate-pulse">Waiting for your friend to join...</p>
                    </div>
                  </div>
                )}

                <div className="flex gap-6 justify-center">
                  {/* Local Video - always show for host, show for joiner when connected */}
                  <Card className="bg-black rounded-3xl p-6 w-full max-w-md shadow-2xl">
                    <div className="relative">
                      <div className="relative rounded-2xl overflow-hidden bg-gray-900 aspect-[4/3]">
                        <video
                          ref={videoRef}
                          autoPlay
                          playsInline
                          muted
                          className="w-full h-full object-cover"
                          style={{
                            filter: availableFilters.find((f) => f.name === currentFilter)?.css || "",
                            transform: currentFilter === "Fisheye" ? "scaleX(-1) scale(1.1)" : "scaleX(-1)",
                          }}
                        />

                        {countdown && (
                          <div className="absolute inset-0 bg-black bg-opacity-70 flex items-center justify-center">
                            <div className="text-white text-4xl font-bold animate-pulse text-center">{countdown}</div>
                          </div>
                        )}

                        {capturedPhotos.length > 0 && (
                          <div className="absolute top-4 right-4 bg-yellow-500 text-black px-3 py-1 rounded-full text-sm font-bold">
                            {capturedPhotos.length}/3
                          </div>
                        )}
                      </div>

                      <div className="flex justify-between items-center mt-4 px-1">
                        {availableFilters.map((filter) => (
                          <Button
                            key={filter.name}
                            variant={currentFilter === filter.name ? "default" : "ghost"}
                            size="sm"
                            className={`text-xs px-2 py-1 h-8 min-w-0 ${
                              currentFilter === filter.name
                                ? "bg-yellow-500 text-black hover:bg-yellow-600 font-semibold"
                                : "text-white hover:bg-gray-800"
                            }`}
                            onClick={() => handleFilterChange(filter.name)}
                          >
                            {filter.label}
                          </Button>
                        ))}
                      </div>

                      <div className="flex justify-center mt-6">
                        <Button
                          onClick={handlePhotoCapture}
                          disabled={isCapturing || capturedPhotos.length >= 3}
                          className="w-16 h-16 rounded-full bg-yellow-500 hover:bg-yellow-600 text-black p-0 shadow-lg disabled:opacity-50"
                        >
                          <Camera className="w-8 h-8" />
                        </Button>
                      </div>

                      <div className="text-center mt-4">
                        <p className="text-white text-sm">
                          {capturedPhotos.length === 0 && "Click to take your first photo"}
                          {capturedPhotos.length === 1 && "Great! Take 2 more photos"}
                          {capturedPhotos.length === 2 && "One more photo to go!"}
                          {capturedPhotos.length === 3 && "All photos taken!"}
                        </p>
                      </div>
                    </div>
                  </Card>

                  {/* Remote Video - only show when connected */}
                  {isConnected && (
                    <Card className="bg-black rounded-3xl p-6 w-full max-w-md shadow-2xl">
                      <div className="relative">
                        <div className="relative rounded-2xl overflow-hidden bg-gray-900 aspect-[4/3]">
                          <video
                            ref={remoteVideoRef}
                            autoPlay
                            playsInline
                            className="w-full h-full object-cover"
                            style={{
                              filter: availableFilters.find((f) => f.name === remoteFilter)?.css || "",
                              transform: remoteFilter === "Fisheye" ? "scaleX(-1) scale(1.1)" : "scaleX(-1)",
                            }}
                          />

                          {countdown && (
                            <div className="absolute inset-0 bg-black bg-opacity-70 flex items-center justify-center">
                              <div className="text-white text-4xl font-bold animate-pulse text-center">{countdown}</div>
                            </div>
                          )}
                        </div>

                        <div className="flex justify-between items-center mt-4 px-1">
                          {availableFilters.map((filter) => (
                            <Button
                              key={filter.name}
                              variant={remoteFilter === filter.name ? "default" : "ghost"}
                              size="sm"
                              className={`text-xs px-2 py-1 h-8 min-w-0 ${
                                remoteFilter === filter.name
                                  ? "bg-yellow-500 text-black hover:bg-yellow-600 font-semibold"
                                  : "text-white hover:bg-gray-800"
                              }`}
                              disabled
                            >
                              {filter.label}
                            </Button>
                          ))}
                        </div>

                        <div className="flex justify-center mt-6">
                          <Button
                            disabled
                            className="w-16 h-16 rounded-full bg-yellow-500 text-black p-0 shadow-lg opacity-50"
                          >
                            <Camera className="w-8 h-8" />
                          </Button>
                        </div>

                        <div className="text-center mt-4">
                          <p className="text-white text-sm">Your friend's view</p>
                        </div>
                      </div>
                    </Card>
                  )}

                  {/* Placeholder for remote video when waiting */}
                  {!isConnected && isHost && isWaitingForPeer && (
                    <Card className="bg-black rounded-3xl p-6 w-full max-w-md shadow-2xl">
                      <div className="relative">
                        <div className="relative rounded-2xl overflow-hidden bg-gray-900 aspect-[4/3] flex items-center justify-center">
                          <div className="text-white text-center">
                            <Users className="w-16 h-16 mx-auto mb-4 opacity-50" />
                            <p className="text-lg">Waiting for friend...</p>
                          </div>
                        </div>
                      </div>
                    </Card>
                  )}
                </div>

                {/* Call Controls */}
                <div className="flex justify-center items-center gap-4">
                  {isConnected && (
                    <div className="bg-black text-white px-4 py-2 rounded-lg font-mono text-lg">
                      {formatCallDuration(callDuration)}
                    </div>
                  )}
                  <Button
                    onClick={endCall}
                    className="bg-red-600 hover:bg-red-700 text-white p-4 rounded-full shadow-lg"
                  >
                    <PhoneOff className="w-6 h-6" />
                  </Button>
                </div>
              </div>
            ) : (
              /* Solo Mode */
              <Card className="bg-black rounded-3xl p-6 max-w-md w-full mx-auto shadow-2xl">
                <div className="relative">
                  <div className="relative rounded-2xl overflow-hidden bg-gray-900 aspect-[4/3]">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                      style={{
                        filter: availableFilters.find((f) => f.name === currentFilter)?.css || "",
                        transform: currentFilter === "Fisheye" ? "scaleX(-1) scale(1.1)" : "scaleX(-1)",
                      }}
                    />

                    {countdown && (
                      <div className="absolute inset-0 bg-black bg-opacity-70 flex items-center justify-center">
                        <div className="text-white text-6xl font-bold animate-pulse text-center">{countdown}</div>
                      </div>
                    )}

                    {capturedPhotos.length > 0 && (
                      <div className="absolute top-4 right-4 bg-yellow-500 text-black px-3 py-1 rounded-full text-sm font-bold">
                        {capturedPhotos.length}/3
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between items-center mt-4 px-1">
                    {availableFilters.map((filter) => (
                      <Button
                        key={filter.name}
                        variant={currentFilter === filter.name ? "default" : "ghost"}
                        size="sm"
                        className={`text-xs px-2 py-1 h-8 min-w-0 ${
                          currentFilter === filter.name
                            ? "bg-yellow-500 text-black hover:bg-yellow-600 font-semibold"
                            : "text-white hover:bg-gray-800"
                        }`}
                        onClick={() => setCurrentFilter(filter.name)}
                      >
                        {filter.label}
                      </Button>
                    ))}
                  </div>

                  <div className="flex justify-center mt-6">
                    <Button
                      onClick={handlePhotoCapture}
                      disabled={isCapturing || capturedPhotos.length >= 3}
                      className="w-16 h-16 rounded-full bg-yellow-500 hover:bg-yellow-600 text-black p-0 shadow-lg disabled:opacity-50"
                    >
                      <Camera className="w-8 h-8" />
                    </Button>
                  </div>

                  <div className="text-center mt-4">
                    <p className="text-white text-sm">
                      {capturedPhotos.length === 0 && "Click to take your first photo"}
                      {capturedPhotos.length === 1 && "Great! Take 2 more photos"}
                      {capturedPhotos.length === 2 && "One more photo to go!"}
                      {capturedPhotos.length === 3 && "All photos taken!"}
                    </p>
                  </div>
                </div>
              </Card>
            )}
          </div>
        ) : (
          <Card className="bg-gradient-to-br from-amber-900 to-amber-800 rounded-3xl p-8 max-w-2xl w-full shadow-2xl border-0">
            <div className="flex gap-8 items-center justify-center">
              <div className="bg-white p-6 rounded-2xl shadow-2xl transform rotate-1 hover:rotate-0 transition-transform duration-300">
                <canvas ref={photoStripCanvasRef} className="max-w-[240px] w-full h-auto rounded-lg shadow-inner" />
              </div>

              <div className="flex flex-col gap-4">
                <Button
                  onClick={resetPhotoBooth}
                  className="bg-amber-700 hover:bg-amber-600 text-white px-8 py-4 text-lg font-bold rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 border-2 border-amber-600"
                >
                  Reshoot
                </Button>
                <Button
                  onClick={downloadStrip}
                  className="bg-amber-700 hover:bg-amber-600 text-white px-8 py-4 text-lg font-bold rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 border-2 border-amber-600"
                >
                  Download Strip
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
