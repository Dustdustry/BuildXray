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

var fadeInTime = 0.15;
var fadeOutTime = 1.2;

var fadeProgress = 0;
var transProgress = 0; // = Interp.smoother(fade)
var areaMask = {draw: null, frame: -1},
    circleMask = {draw: null, frame: -1};

Events.on(ClientLoadEvent, e => {
    changeModDescription();

    addSettings(Vars.ui.settings.graphics);

    Events.run(Trigger.update, () => {
        transparent = Core.settings.getInt("build-xray.transparent") / 100;
        mouseMaskRadius = Core.settings.getInt("build-xray.mouse-mask-radius") * Vars.tilesize;
        fadeInTime = Core.settings.getInt("build-xray.fade-in") / 1000;
        fadeOutTime = Core.settings.getInt("build-xray.fade-out") / 1000;
    });

    function changeModDescription() {
        const key = "build-xray.description";
        let i = 0;
        const lines = [];
        while (Core.bundle.has(key + "." + i)) {
            lines.push(Core.bundle.get(key + "." + i));
            i++;
        }

        if (lines.length > 0) {
            thisMod.meta.description = lines.map(l => UI.formatIcons(l)).join("\n");
        }
    }

    function addSettings(settings) {
        // add category for mdtx
        if (settings.addCategory) {
            settings.addCategory("build-xray");
        }

        // sliderPref 的 def/min/max 用的是滑块自己的单位（% / 格 / ms）
        settings.sliderPref("build-xray.transparent", Math.round(transparent * 100), 0, 100, 5, p => p + "%");
        settings.sliderPref("build-xray.mouse-mask-radius", Math.round(mouseMaskRadius / Vars.tilesize), 8, 64, 4, p =>
            Core.bundle.format("setting.tile", p),
        );
        settings.sliderPref("build-xray.fade-in", Math.round(fadeInTime * 1000), 0, 1000, 50, p =>
            Core.bundle.format("setting.milliseconds", p),
        );
        settings.sliderPref("build-xray.fade-out", Math.round(fadeOutTime * 1000), 0, 3000, 100, p =>
            Core.bundle.format("setting.milliseconds", p),
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

    const isBreaking = input.isBreaking();
    const isRebuildSelecting = input.isRebuildSelecting();
    const isPlacingOrDropping = input.isPlacing() || input.isDroppingItem();

    const isPlanning = isSchematicSelecting || isBreaking || isRebuildSelecting || isPlacingOrDropping;

    const drawFrame = Core.graphics.getFrameId();

    fadeProgress = Mathf.approachDelta(
        fadeProgress,
        Mathf.num(isPlanning),
        1 / 60 / (isPlanning ? fadeInTime : fadeOutTime),
    );

    if (Mathf.zero(fadeProgress)) {
        transProgress = 0;
        areaMask.draw = circleMask.draw = null;
        return;
    }

    transProgress = Interp.smoother.apply(fadeProgress);

    transBuffer.resize(Core.graphics.getWidth(), Core.graphics.getHeight());
    screenBuffer.resize(Core.graphics.getWidth(), Core.graphics.getHeight());

    transBuffer.begin(Color.clear);

    Draw.alpha(transProgress * transparent);

    if (isBreaking) {
        const maxLength =
            isDesktop && Core.input.keyDown(Binding.schematicSelect) && input.schemX != -1 && input.schemY != -1
                ? Vars.maxSchematicSize
                : 100;
        drawAreaMask(
            isDesktop ? input.selectX : input.lineStartX,
            isDesktop ? input.selectY : input.lineStartY,
            maxLength,
        );
    } else if (isSchematicSelecting) {
        drawAreaMask(
            isDesktop ? input.schemX : input.lineStartX,
            isDesktop ? input.schemY : input.lineStartY,
            Vars.maxSchematicSize,
        );
    } else if (isRebuildSelecting) {
        drawAreaMask(isDesktop ? input.schemX : input.lineStartX, isDesktop ? input.schemY : input.lineStartY, 0);
    }

    if (isPlacingOrDropping) {
        const {x, y} = Core.input.mouseWorld();
        Draw.rect("circle-shadow", x, y, mouseMaskRadius, mouseMaskRadius);
        circleMask.draw = () => Draw.rect("circle-shadow", x, y, mouseMaskRadius, mouseMaskRadius);
        circleMask.frame = drawFrame;
    }

    // 本帧如果没有任何实时 mask，说明动作都结束了、alpha 正在衰减：用冻结的几何继续显示
    // 反之（有实时 mask）就丢弃另一类冻结几何，避免它之后又冒出来
    if (areaMask.frame === drawFrame || circleMask.frame === drawFrame) {
        if (areaMask.frame !== drawFrame) areaMask.draw = null;
        if (circleMask.frame !== drawFrame) circleMask.draw = null;
    } else {
        if (areaMask.draw) areaMask.draw();
        if (circleMask.draw) circleMask.draw();
    }

    Draw.reset();

    transBuffer.end();

    // beam drill
    applyTrans(Layer.power - 1.001, Layer.power - 0.999);
    // leg units
    applyTrans(Layer.legUnit - 2.001, Layer.legUnit + 2.001);
    // flying units
    applyTrans(Layer.flyingUnitLow - 2.001, Layer.flyingUnit + 2.001);

    function applyTrans(zStart, zEnd) {
        Draw.draw(zStart, () => {
            screenBuffer.begin(Color.clear);
        });

        Draw.draw(zEnd, () => {
            screenBuffer.end();

            transBuffer.getTexture().bind(1);
            Blending.normal.apply(); // 最后一个 DrawRequest 的混合模式不会恢复，需要手动恢复
            screenBuffer.blit(transShader);
        });
    }
});

// 采集范围框：把最终矩形（中心 + 尺寸）冻结下来，之后重放不再依赖输入状态
function drawAreaMask(startX, startY, maxLength) {
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

    const centerX = (result.x + result.x2) / 2,
        centerY = (result.y + result.y2) / 2;
    const width = (result.x2 - result.x) * Mathf.sqrt2 * 1.5,
        height = (result.y2 - result.y) * Mathf.sqrt2 * 1.5;

    Draw.rect("circle-shadow", centerX, centerY, width, height);

    areaMask.draw = () => Draw.rect("circle-shadow", centerX, centerY, width, height);
    areaMask.frame = Core.graphics.getFrameId();
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
