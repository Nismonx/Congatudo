import MapStructure from "./MapStructure";
import chargerIconSVG from "../icons/charger.svg";
import {Canvas2DContextTrackingWrapper} from "../../utils/Canvas2DContextTrackingWrapper";
import {ValetudoMapCanvasImageAsset} from "../../utils/ValetudoMapCanvasImageAsset";
import {considerHiDPI} from "../../utils/helpers";

const img = new ValetudoMapCanvasImageAsset();
img.src = chargerIconSVG;

class ChargerLocationMapStructure extends MapStructure {
    public static TYPE = "ChargerLocationMapStructure";

    constructor(x0: number, y0: number) {
        super(x0, y0);
    }

    draw(ctxWrapper: Canvas2DContextTrackingWrapper, transformationMatrixToScreenSpace: DOMMatrixInit, scaleFactor: number): void {
        const ctx = ctxWrapper.getContext();
        const p0 = new DOMPoint(this.x0, this.y0).matrixTransform(transformationMatrixToScreenSpace);

        const scaledSize = {
            width: Math.max(img.hiDPIAwareWidth / (considerHiDPI(4.5) / scaleFactor), img.hiDPIAwareWidth),
            height: Math.max(img.hiDPIAwareWidth / (considerHiDPI(4.5) / scaleFactor), img.hiDPIAwareHeight)
        };

        ctx.drawImage(
            img,
            p0.x - scaledSize.width / 2,
            p0.y - scaledSize.height / 2,
            scaledSize.width,
            scaledSize.height
        );
    }

    getType(): string {
        return ChargerLocationMapStructure.TYPE;
    }
}

export default ChargerLocationMapStructure;
