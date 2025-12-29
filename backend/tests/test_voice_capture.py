# test_voice_capture.py
import sys
from voice.voice import capture_and_parse_command

def main():
    print("Starting voice capture test...")
    parsed = capture_and_parse_command(duration=5.0)  # record 5 seconds
    if parsed:
        print("Parsed parameters from voice command:")
        print(parsed)
    else:
        print("No command detected or could not understand audio.")

if __name__ == "__main__":
    main()
