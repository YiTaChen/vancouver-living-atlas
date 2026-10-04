"""Finalize the complete four-asset optional paired-window package."""
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).resolve().parent/"finalize_sills.py"),run_name="__main__")
