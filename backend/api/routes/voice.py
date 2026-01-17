from fastapi import APIRouter, HTTPException, UploadFile, File
import os
from io import BytesIO
from elevenlabs.client import ElevenLabs

router = APIRouter()

# Initialize ElevenLabs API key
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")

# Initialize ElevenLabs client
elevenlabs_client = None
if ELEVENLABS_API_KEY:
    try:
        elevenlabs_client = ElevenLabs(api_key=ELEVENLABS_API_KEY)
        print("[VOICE] ElevenLabs Speech-to-Text API initialized with SDK")
    except Exception as e:
        print(f"[VOICE] WARNING: Failed to initialize ElevenLabs SDK: {e}")
        elevenlabs_client = None
else:
    print("[VOICE] WARNING: ELEVENLABS_API_KEY not set. Speech-to-text will not work.")


@router.post("/transcribe-audio")
async def transcribe_audio(audio_file: UploadFile = File(...)):
    """
    Transcribe audio using ElevenLabs Speech-to-Text (Scribe) API.
    
    Accepts audio file in various formats (mp3, mp4, wav, webm, etc.).
    Returns transcribed text.
    """
    if not elevenlabs_client:
        raise HTTPException(
            status_code=500,
            detail="ElevenLabs API not configured. Please set ELEVENLABS_API_KEY in backend/.env"
        )
    
    try:
        # Read audio file content
        content = await audio_file.read()
        print(f"[VOICE] Transcribing audio file: {audio_file.filename} ({len(content)} bytes)")
        
        # Convert content to BytesIO for the SDK
        audio_data = BytesIO(content)
        
        # Use the official ElevenLabs SDK (as per documentation)
        print(f"[VOICE] Using ElevenLabs SDK to transcribe with model_id='scribe_v2'")
        transcription = elevenlabs_client.speech_to_text.convert(
            file=audio_data,
            model_id="scribe_v2",  # As per official docs
            tag_audio_events=False,  # Optional: tag audio events like laughter, applause
            language_code="eng",  # Language code, or None for auto-detect
            diarize=False  # Optional: annotate who is speaking
        )
        
        # Extract text from transcription result
        # The SDK returns a SpeechToTextResponse object
        text = ""
        if hasattr(transcription, 'text'):
            text = transcription.text
        elif isinstance(transcription, str):
            text = transcription
        elif isinstance(transcription, dict):
            text = transcription.get('text', '')
        else:
            # Try to get text from the response object
            text = str(transcription)
        
        text = text.strip() if text else ""
        
        print(f"[VOICE] Transcription result: '{text}'")
        
        # Get language if available
        language = "en"
        if hasattr(transcription, 'language'):
            language = transcription.language
        elif isinstance(transcription, dict):
            language = transcription.get('language', 'en')
        
        return {
            "text": text,
            "language": language
        }
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        print(f"[VOICE] Transcription error: {e}")
        import traceback
        traceback.print_exc()
        error_msg = str(e) if str(e) else "Unknown error occurred during transcription"
        raise HTTPException(
            status_code=500,
            detail=f"Failed to transcribe audio: {error_msg}"
        )
