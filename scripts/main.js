// code by minRi2
const screenBuffer = new FrameBuffer();
const transBuffer = new FrameBuffer();

const thisMod = Vars.mods.locateMod(modName);
const shaderFolder = thisMod.root.child("shaders");

const buildXrayFrag = [
    "uniform sampler2D u_texture;",
    "uniform sampler2D u_trans_texture;",
    "",
    "varying vec2 v_texCoords;",
    "",
    "void main(){",
    "    vec4 color = texture2D(u_texture, v_texCoords);",
    "    float alpha = texture2D(u_trans_texture, v_texCoords).a;",
    "    color.a *= 1.0 - alpha;",
    "    gl_FragColor = color;",
    "}",
].join("\n");

const transShader = extend(Shader, findShaderFi("screenspace.vert").readString(), buildXrayFrag, {
    apply() {
        this.setUniformi("u_trans_texture", 1);
    },
});

var transparent = 0.8;
var mouseMaskRadius = Vars.tilesize * 32;

var transProgress = 0;

Events.on(ClientLoadEvent, e => {
    addSettings(Vars.ui.settings.graphics);

    Events.run(Trigger.update, () => {
        transparent = Core.settings.getInt("build-xray.transparent") / 100;
        mouseMaskRadius = Core.settings.getInt("build-xray.mouse-mask-radius") * Vars.tilesize;
    });

    function addSettings(settings) {
        settings.addCategory("build-xray");
        settings.sliderPref("build-xray.transparent", transparent, 0, 100, 10, p => p + "%");
        settings.sliderPref("build-xray.mouse-mask-radius", mouseMaskRadius, 8, 64, 4, p =>
            Core.bundle.format("setting.tile", p),
        );
    }
});

Events.run(Trigger.draw, () => {
    const input = Vars.control.input;
    const isDesktop = input instanceof DesktopInput;

    const isSchematicSelecting = isDesktop
        ? Core.input.keyDown(Binding.schematicSelect) &&
          input.schemX != -1 &&
          input.schemY != -1 &&
          !Core.scene.hasKeyboard()
        : input.schematicMode;

    const isPlanning =
        isSchematicSelecting ||
        input.isPlacing() ||
        input.isBreaking() ||
        input.isDroppingItem() ||
        input.isRebuildSelecting();

    transProgress = Mathf.lerp(transProgress, Mathf.num(isPlanning), 0.02);

    if (Mathf.zero(transProgress)) return;

    transBuffer.resize(Core.graphics.getWidth(), Core.graphics.getHeight());
    screenBuffer.resize(Core.graphics.getWidth(), Core.graphics.getHeight());

    transBuffer.begin(Color.clear);

    Draw.alpha(transProgress * transparent);

    if (input.isBreaking()) {
        const maxLength =
            isDesktop && Core.input.keyDown(Binding.schematicSelect) && input.schemX != -1 && input.schemY != -1
                ? Vars.maxSchematicSize
                : 100;
        drawSelectionArea(
            isDesktop ? input.selectX : input.lineStartX,
            isDesktop ? input.selectY : input.lineStartY,
            maxLength,
        );
    } else if (isSchematicSelecting) {
        drawSelectionArea(
            isDesktop ? input.schemX : input.lineStartX,
            isDesktop ? input.schemY : input.lineStartY,
            Vars.maxSchematicSize,
        );
    } else if (input.isRebuildSelecting()) {
        drawSelectionArea(isDesktop ? input.schemX : input.lineStartX, isDesktop ? input.schemY : input.lineStartY, 0);
    }

    if (input.isPlacing() || input.isDroppingItem()) {
        const {x, y} = Core.input.mouseWorld();
        Draw.rect("circle-shadow", x, y, mouseMaskRadius, mouseMaskRadius);
    }

    Draw.reset();

    transBuffer.end();

    applyTrans(Layer.legUnit - 2.001, Layer.legUnit + 2.001);
    applyTrans(Layer.flyingUnitLow - 2.001, Layer.flyingUnit + 2.001);
    // applyTrans(Layer.overlayUI - 0.001, Layer.overlayUI + 0.001)

    function applyTrans(zStart, zEnd) {
        Draw.draw(zStart, () => {
            screenBuffer.begin(Color.clear);
        });

        Draw.draw(zEnd, () => {
            screenBuffer.end();

            transBuffer.getTexture().bind(1);
            screenBuffer.blit(transShader);
        });
    }
});

function drawSelectionArea(startX, startY, maxLength) {
    if (startX < 0 || startY < 0) return;

    const {x, y} = Core.input.mouseWorld();
    const result = Placement.normalizeDrawArea(
        Blocks.air,
        startX,
        startY,
        World.toTile(x),
        World.toTile(y),
        false,
        maxLength,
        1,
    );
    drawAreaMask(result.x, result.y, result.x2, result.y2);
}

function drawAreaMask(x, y, x2, y2) {
    const centerX = (x + x2) / 2,
        centerY = (y + y2) / 2;
    const width = (x2 - x) * Mathf.sqrt2 * 1.5,
        height = (y2 - y) * Mathf.sqrt2 * 1.5;
    Draw.rect("circle-shadow", centerX, centerY, width, height);
}

function findShaderFi(name) {
    let fi = shaderFolder.child(name);
    if (fi && fi.exists()) return fi;
    fi = Vars.tree.get(name);
    if (fi && fi.exists()) return fi;
    fi = Vars.tree.get("shaders/" + name);
    if (fi && fi.exists()) return fi;
    fi = Core.files.internal("shaders/" + name);
    return fi && fi.exists() ? fi : null;
}
