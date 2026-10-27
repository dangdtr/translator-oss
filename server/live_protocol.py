"""Version 2 local protocol. PCM frames start with big-endian epoch/sequence."""
import struct

MAX_FRAME_BYTES = 64_000


class ProtocolError(Exception):
    pass


def audio_frame(epoch, sequence, pcm):
    return struct.pack('!II', epoch, sequence) + pcm


def read_audio_frame(data):
    if len(data) < 10 or len(data) > MAX_FRAME_BYTES + 8 or len(data) % 2:
        raise ProtocolError()
    epoch, sequence = struct.unpack('!II', data[:8])
    return epoch, sequence, data[8:]


def command(message):
    if not isinstance(message, dict):
        raise ProtocolError()
    if message.get('type') not in {'start', 'pause', 'resume', 'seek', 'stop', 'playback_status'}:
        raise ProtocolError()
    epoch = message.get('epoch')
    if type(epoch) is not int or not 0 <= epoch <= 0xffffffff:
        raise ProtocolError()
    if not isinstance(message.get('sessionId'), str) or not 1 <= len(message['sessionId']) <= 128:
        raise ProtocolError()
    request = message.get('requestId')
    if not isinstance(request, str) or len(request) > 128:
        raise ProtocolError()
    if message['type'] == 'start' and message.get('protocolVersion') != 2:
        raise ProtocolError()
    if 'paused' in message and type(message['paused']) is not bool:
        raise ProtocolError()
    return message
