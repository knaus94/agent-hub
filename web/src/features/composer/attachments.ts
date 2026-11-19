import { uploadTicket } from '../../entities/hub/hub-store';
import type { Attach } from '../../shared/protocol.ts';

// Something sent with a message: a picture or a file from the device, or a link to a file of the chat's project.
export type Attachment =
   | { id: string; kind: 'picture'; name: string; blob: Blob; url: string }
   | { id: string; kind: 'file'; name: string; blob: Blob }
   | { id: string; kind: 'link'; path: string };

// As the hub takes them: at most this many, each file at most FILE_LIMIT, all of them at most TOTAL_LIMIT.
export const ATTACHMENTS_MAX = 10;
const FILE_LIMIT = 3 << 20;
const TOTAL_LIMIT = 4 << 20;
// Claude scales a larger picture down to this anyway, and every picture stays in the chat's history.
const PICTURE_SIDE = 1568;
const PICTURE_BYTES = 1 << 20;
const PICTURES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

// Why attachments cannot go, and the file it is about: the hub's reasons, and those found before asking it.
const CODES = ['unsupported', 'large', 'total', 'many', 'missing', 'offline', 'invalid', 'connection'] as const;
export type AttachCode = (typeof CODES)[number];

export class AttachError extends Error {
   constructor(
      readonly code: AttachCode,
      readonly file = '',
   ) {
      super(code);
   }
}

let counter = 0;
const nextId = () => `attachment-${++counter}`;

// A picture larger than the agent needs goes as a smaller JPEG; one the browser cannot draw, such as HEIC outside Safari,
// goes as it is when it is a kind the agent takes.
async function smaller(file: File) {
   const bitmap = await createImageBitmap(file).catch(() => null);
   if (!bitmap) return PICTURES.includes(file.type) ? file : null;
   const scale = Math.min(1, PICTURE_SIDE / Math.max(bitmap.width, bitmap.height));
   if (scale === 1 && file.size <= PICTURE_BYTES && PICTURES.includes(file.type)) {
      bitmap.close();
      return file;
   }
   const canvas = document.createElement('canvas');
   canvas.width = Math.round(bitmap.width * scale);
   canvas.height = Math.round(bitmap.height * scale);
   canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
   bitmap.close();
   return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
}

// fromFile turns a file picked, pasted or dropped into an attachment the chat takes.
export async function fromFile(file: File, attach: Attach): Promise<Attachment> {
   const name = file.name || 'image';
   if (file.type.startsWith('image/') && attach.images) {
      const blob = await smaller(file);
      if (!blob) throw new AttachError('unsupported', name);
      const sent = blob === file ? name : `${name.replace(/\.[^.]+$/, '')}.jpg`;
      return { id: nextId(), kind: 'picture', name: sent, blob, url: URL.createObjectURL(blob) };
   }
   if (!attach.files) throw new AttachError('unsupported', name);
   if (file.size > FILE_LIMIT) throw new AttachError('large', name);
   return { id: nextId(), kind: 'file', name, blob: file };
}

export function link(path: string): Attachment {
   return { id: nextId(), kind: 'link', path };
}

export function attachmentName(attachment: Attachment) {
   return attachment.kind === 'link' ? (attachment.path.split('/').pop() ?? attachment.path) : attachment.name;
}

export function release(attachments: Attachment[]) {
   for (const attachment of attachments) if (attachment.kind === 'picture') URL.revokeObjectURL(attachment.url);
}

// sendWithAttachments sends a message with its attachments in one upload; the hub then sends it on as it sends any.
export async function sendWithAttachments(sessionId: string, text: string, attachments: Attachment[]) {
   const total = attachments.reduce((sum, attachment) => sum + (attachment.kind === 'link' ? 0 : attachment.blob.size), 0);
   if (total > TOTAL_LIMIT) throw new AttachError('total');
   const form = new FormData();
   form.set('sessionId', sessionId);
   form.set('text', text);
   for (const attachment of attachments)
      if (attachment.kind === 'link') form.append('link', attachment.path);
      else form.append('file', attachment.blob, attachment.name);
   const ticket = await uploadTicket().catch(() => {
      throw new AttachError('connection');
   });
   const response = await fetch(`/send?ticket=${encodeURIComponent(ticket)}`, { method: 'POST', body: form }).catch(() => {
      throw new AttachError('connection');
   });
   if (response.ok) return;
   const reason = (await response.json().catch(() => null)) as { error?: string; file?: string } | null;
   throw new AttachError(CODES.find((code) => code === reason?.error) ?? 'invalid', reason?.file);
}
