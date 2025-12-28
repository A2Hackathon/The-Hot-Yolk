from dotenv import load_dotenv
import os

# Load environment variables
load_dotenv()

# Import your parser
from world.prompt_parser import parse_prompt

# Test prompts
test_prompts = [
    "an icy city at sunset with 6 enemies and only fists",
    "make it darker and add more bad guys",
    "add 3 buildings to the city and 3 trees",
    "arctic landscape with 3 mountains and 8 sentinels with staff",
    "city with river at noon",
    "gimme a snowy place with like 5 enemies"
]

print("Testing Groq Parser...\n")

for prompt in test_prompts:
    print(f"Prompt: {prompt}")
    result = parse_prompt(prompt)
    print(f"Result: {result}\n")