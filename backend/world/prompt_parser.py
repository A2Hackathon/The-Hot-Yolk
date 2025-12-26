import spacy

# Load spaCy English model
nlp = spacy.load("en_core_web_sm")

#  Keyword lists 
biomes = ["arctic", "city"]
times = ["sunset", "noon", "night"]
sky_keywords = ["sun", "cloud", "star", "clouds", "stars"]
ground_keywords = ["snow", "street"]
structure_keywords = ["mountain", "hill", "river"]
object_keywords = ["tree", "building", "street lamp", "graffiti"]

def parse_prompt(prompt: str) -> dict:
    doc = nlp(prompt.lower())

    extracted = {
        "biome": [b for b in biomes if b in prompt.lower()],
        "time": [t for t in times if t in prompt.lower()],
        "sky": [s for s in sky_keywords if s in prompt.lower()],
        "ground": [g for g in ground_keywords if g in prompt.lower()],
        "structure": {},
        "object": {}
    }

    for token in doc:
        # If the token is a number
        if token.pos_ == "NUM":
            # Check children (dependency tree) for structure nouns
            for child in token.children:
                lemma = child.lemma_
                if lemma in structure_keywords:
                    extracted["structure"][lemma] = int(token.text)
            # Also check next token
            if token.i + 1 < len(doc):
                next_token = doc[token.i + 1]
                if next_token.lemma_ in structure_keywords:
                    extracted["structure"][next_token.lemma_] = int(token.text)

    for token in doc:
        lemma = token.lemma_
        if lemma in structure_keywords and lemma not in extracted["structure"]:
            extracted["structure"][lemma] = 1

        if lemma in object_keywords and lemma not in extracted["object"]:
            extracted["object"][lemma] = 1

    return extracted

