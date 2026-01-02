import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


from world.physics_config import get_combined_config
import pprint

# Get the "both" config
config = get_combined_config("both")

# Pretty-print combat config
pprint.pprint(config["combat"])
