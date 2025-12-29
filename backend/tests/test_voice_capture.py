# backend/tests/test_voice_capture.py
import sys
import os
from pathlib import Path

# Make sure backend modules are importable
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BASE_DIR))

from voice.voice import capture_and_parse_command

def test_voice_capture():
    """
    Simple test to capture audio from the microphone and parse it
    using your voice.py pipeline.
    """
    print("=== Voice Capture Test ===")
    print("Please speak a test command into your microphone...")
    
    parsed_params = capture_and_parse_command()
    
    if parsed_params:
        print("Parsed command output:")
        print(parsed_params)
    else:
        print("No command detected or recognition failed.")

if __name__ == "__main__":
    test_voice_capture()
