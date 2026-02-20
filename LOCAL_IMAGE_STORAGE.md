# Local Image Storage for Chat Messages

This document describes the frontend implementation required to store and retrieve large images in the browser's IndexedDB.

## Overview

When API responses contain large images (>50KB), the backend:
1. Extracts the image data
2. Generates a unique reference ID (e.g., `img_abc123def456`)
3. Stores a placeholder in DynamoDB: `[[LOCAL_IMAGE:img_abc123def456]]`
4. Sends the image data to the frontend via SSE for local storage

## Backend Events

### 1. SSE Event: `store_images`

When streaming chat responses, if the assistant message contains large images, you'll receive:

```typescript
{
  type: 'store_images',
  data: {
    messageId: string,        // The chat message ID
    images: Array<{
      refId: string,          // e.g., "img_abc123def456"
      data: string,           // Base64 or data URL
      mimeType?: string       // e.g., "image/png"
    }>
  }
}
```

### 2. REST Response: `imagesToStore`

When posting a user message, the response may include:

```typescript
{
  success: true,
  data: { ... },              // The saved message
  imagesToStore?: Array<{     // Only present if images were extracted
    refId: string,
    data: string,
    mimeType?: string
  }>
}
```

## Frontend Implementation

### 1. IndexedDB Setup

Create an IndexedDB database for storing images:

```typescript
// utils/imageStorage.ts

const DB_NAME = 'apix-chat-images'
const STORE_NAME = 'images'
const DB_VERSION = 1

interface StoredImage {
  refId: string
  data: string
  mimeType?: string
  storedAt: number
}

let db: IDBDatabase | null = null

export async function initImageDB(): Promise<IDBDatabase> {
  if (db) return db

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)

    request.onsuccess = () => {
      db = request.result
      resolve(db)
    }

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'refId' })
      }
    }
  })
}

export async function storeImage(refId: string, data: string, mimeType?: string): Promise<void> {
  const database = await initImageDB()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    const image: StoredImage = {
      refId,
      data,
      mimeType,
      storedAt: Date.now()
    }

    const request = store.put(image)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export async function getImage(refId: string): Promise<string | null> {
  const database = await initImageDB()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)

    const request = store.get(refId)
    request.onsuccess = () => {
      const result = request.result as StoredImage | undefined
      resolve(result?.data || null)
    }
    request.onerror = () => reject(request.error)
  })
}

export async function deleteImage(refId: string): Promise<void> {
  const database = await initImageDB()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    const request = store.delete(refId)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

// Clean up old images (optional, call periodically)
export async function cleanupOldImages(maxAgeDays: number = 7): Promise<number> {
  const database = await initImageDB()
  const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000)
  let deleted = 0

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    const request = store.openCursor()
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result
      if (cursor) {
        const image = cursor.value as StoredImage
        if (image.storedAt < cutoff) {
          cursor.delete()
          deleted++
        }
        cursor.continue()
      } else {
        resolve(deleted)
      }
    }
    request.onerror = () => reject(request.error)
  })
}
```

### 2. Handle SSE Events

When receiving the `store_images` event during chat streaming:

```typescript
// In your SSE event handler
eventSource.onmessage = async (event) => {
  const { type, data } = JSON.parse(event.data)

  switch (type) {
    case 'token':
      // Handle streaming tokens...
      break

    case 'store_images':
      // Store images in IndexedDB
      for (const image of data.images) {
        try {
          await storeImage(image.refId, image.data, image.mimeType)
          console.log(`Stored image ${image.refId} in IndexedDB`)
        } catch (error) {
          console.error(`Failed to store image ${image.refId}:`, error)
        }
      }
      break

    case 'done':
      // Streaming complete
      break
  }
}
```

### 3. Render Messages with Local Images

When rendering chat messages, replace `[[LOCAL_IMAGE:refId]]` placeholders:

```typescript
// components/ChatMessage.tsx
import { useEffect, useState } from 'react'
import { getImage } from '../utils/imageStorage'

interface ChatMessageProps {
  content: string
  localImageRefs?: Array<{
    refId: string
    mimeType?: string
    placeholder: string
  }>
}

export function ChatMessage({ content, localImageRefs }: ChatMessageProps) {
  const [processedContent, setProcessedContent] = useState(content)
  const [loadedImages, setLoadedImages] = useState<Record<string, string>>({})

  useEffect(() => {
    async function loadLocalImages() {
      if (!localImageRefs || localImageRefs.length === 0) return

      const images: Record<string, string> = {}

      for (const ref of localImageRefs) {
        const imageData = await getImage(ref.refId)
        if (imageData) {
          images[ref.refId] = imageData
        }
      }

      setLoadedImages(images)
    }

    loadLocalImages()
  }, [localImageRefs])

  // Replace placeholders with actual images or fallback text
  useEffect(() => {
    let processed = content

    // Find all [[LOCAL_IMAGE:xxx]] placeholders
    const placeholderRegex = /\[\[LOCAL_IMAGE:([^\]]+)\]\]/g
    let match

    while ((match = placeholderRegex.exec(content)) !== null) {
      const refId = match[1]
      const imageData = loadedImages[refId]

      if (imageData) {
        // Replace with img tag (or your image component)
        processed = processed.replace(
          match[0],
          `<img src="${imageData}" alt="Generated image" class="chat-image" />`
        )
      } else {
        // Show placeholder text if image not found
        const ref = localImageRefs?.find(r => r.refId === refId)
        processed = processed.replace(
          match[0],
          ref?.placeholder || '[Image not available]'
        )
      }
    }

    setProcessedContent(processed)
  }, [content, loadedImages, localImageRefs])

  return (
    <div
      className="chat-message"
      dangerouslySetInnerHTML={{ __html: processedContent }}
    />
  )
}
```

### 4. Alternative: React Component for Images

For better control, use a custom component:

```typescript
// components/LocalImage.tsx
import { useEffect, useState } from 'react'
import { getImage } from '../utils/imageStorage'

interface LocalImageProps {
  refId: string
  placeholder?: string
  className?: string
}

export function LocalImage({ refId, placeholder, className }: LocalImageProps) {
  const [src, setSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const data = await getImage(refId)
        if (data) {
          setSrc(data)
        } else {
          setError(true)
        }
      } catch (err) {
        console.error(`Failed to load image ${refId}:`, err)
        setError(true)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [refId])

  if (loading) {
    return <div className="image-loading">Loading image...</div>
  }

  if (error || !src) {
    return <div className="image-placeholder">{placeholder || 'Image not available'}</div>
  }

  return <img src={src} alt="Generated image" className={className} />
}
```

## Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                         BACKEND                                  │
├─────────────────────────────────────────────────────────────────┤
│  1. API returns large image (>50KB base64)                      │
│                         ↓                                        │
│  2. chatSessionService.saveMessage() extracts image             │
│     - Generates refId: "img_abc123"                             │
│     - Stores in DynamoDB: "[[LOCAL_IMAGE:img_abc123]]"          │
│     - Returns imagesToStore array                               │
│                         ↓                                        │
│  3. SSE sends: { type: 'store_images', images: [...] }          │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND                                  │
├─────────────────────────────────────────────────────────────────┤
│  4. Receives 'store_images' SSE event                           │
│     - Stores each image in IndexedDB with refId as key          │
│                         ↓                                        │
│  5. When rendering message:                                      │
│     - Detects [[LOCAL_IMAGE:img_abc123]] placeholder            │
│     - Loads image from IndexedDB                                │
│     - Renders <img src={data} /> or placeholder                 │
└─────────────────────────────────────────────────────────────────┘
```

## Message Format in DynamoDB

```json
{
  "id": "msg-uuid",
  "sessionId": "session-uuid",
  "role": "assistant",
  "content": "Here is your generated logo: [[LOCAL_IMAGE:img_abc123def456]]",
  "timestamp": "2024-01-15T10:30:00Z",
  "localImageRefs": [
    {
      "refId": "img_abc123def456",
      "mimeType": "image/png",
      "size": 245000,
      "placeholder": "[Image: image/png, 239KB]"
    }
  ]
}
```

## Limitations

1. **Device-specific**: Images are only available on the device/browser where they were generated
2. **Browser data clearing**: Images are lost if user clears browser data
3. **Storage quota**: IndexedDB has browser-specific limits (typically 50MB+)
4. **No cross-device sync**: Images won't appear on other devices

## Optional Enhancements

1. **Periodic cleanup**: Call `cleanupOldImages(7)` to remove images older than 7 days
2. **Storage quota monitoring**: Check available storage and warn users
3. **Export functionality**: Allow users to download images before they expire
4. **Fallback display**: Show a "regenerate" button when images are missing
