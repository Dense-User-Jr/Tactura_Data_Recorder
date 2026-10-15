"""Export the trained scikit-learn model for on-watch ONNX inference."""

from pathlib import Path

import joblib
import onnx
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType


PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = PROJECT_ROOT / "ML" / "gesture_random_forest.joblib"
OUTPUT_PATH = PROJECT_ROOT / "wear" / "src" / "main" / "assets" / "gesture_random_forest.onnx"


def main():
    artifact = joblib.load(MODEL_PATH)
    model = artifact["model"]
    onnx_model = convert_sklearn(
        model,
        initial_types=[("features", FloatTensorType([None, model.n_features_in_]))],
        options={id(model): {"zipmap": False}},
        target_opset=17,
    )
    # ONNX Runtime 1.17 on Wear OS supports IR 9 and opset 17.
    onnx_model.ir_version = 9
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_bytes(onnx_model.SerializeToString())
    print(f"Exported {len(artifact['feature_names'])} features to {OUTPUT_PATH}")
    print(f"Classes: {', '.join(model.classes_)}")


if __name__ == "__main__":
    main()