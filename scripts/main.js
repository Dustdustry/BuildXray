const {getPlanArea} = require("plan-area");

const screenBuffer = new FrameBuffer();

const thisMod = Vars.mods.locateMod(modName);
const shaderFolder = thisMod.root.child("shaders");

const peekBind = KeyBind.add("build-xray.peek", KeyCode.altLeft, "build-xray");

// 边缘最小宽度的像素范围，实际值在 maskSoft 的 0..1 之间插值
const maskEdgePxMin = 2,
    maskEdgePxMax = 48;

const buildXrayFrag = [
    // 世界坐标数值大，GLES 的 mediump 精度不够
    "#define HIGHP",
    "uniform sampler2D u_texture;",
    "uniform vec2 u_camPos;",
    "uniform vec2 u_camSize;",
    "uniform float u_strength;",
    "uniform float u_bandScl;",
    "uniform float u_rectExpand;",
    "uniform float u_edge;",
    "uniform vec4 u_shapeA;",
    "uniform vec4 u_shapeB;",
    "uniform vec2 u_shapeType;",
    "",
    "varying vec2 v_texCoords;",
    "",
    "float soft(float d, float band){",
    "    return 1.0 - smoothstep(0.0, band, d);",
    "}",
    "",
    "float rectMask(vec2 p, vec4 s){",
    "    vec2 q = abs(p - s.xy) - s.zw;",
    "    return soft(length(max(q, 0.0)), max(u_edge, min(s.z, s.w) * u_bandScl) + u_rectExpand);",
    "}",
    "",
    "float circleMask(vec2 p, vec4 s){",
    "    return soft(length(p - s.xy) - s.z, max(u_edge, s.z * u_bandScl));",
    "}",
    "",
    "float shapeMask(vec2 p, vec4 s, float type){",
    "    if(type > 1.5) return circleMask(p, s);",
    "    if(type > 0.5) return rectMask(p, s);",
    "    return 0.0;",
    "}",
    "",
    "void main(){",
    // v_texCoords 恒为 0..1 覆盖当前目标视口；gl_FragCoord 会随 pixelate 的分辨率变化
    "    vec2 ndc = v_texCoords * 2.0 - 1.0;",
    "    vec2 world = u_camPos + ndc * u_camSize * 0.5;",
    "",
    "    float mask = max(shapeMask(world, u_shapeA, u_shapeType.x), shapeMask(world, u_shapeB, u_shapeType.y));",
    "",
    "    vec4 color = texture2D(u_texture, v_texCoords);",
    "    gl_FragColor = vec4(color.rgb, color.a * (1.0 - mask * u_strength));",
    "}",
].join("\n");

const transShader = extend(Shader, findShaderFi("screenspace.vert").readString(), buildXrayFrag, {
    apply() {
        const cam = Core.camera;
        const a = areaMask.shape,
            b = circleMask.shape;
        const edgePx = maskEdgePxMin + (maskEdgePxMax - maskEdgePxMin) * maskSoft;

        this.setUniformf("u_camPos", cam.position.x, cam.position.y);
        this.setUniformf("u_camSize", cam.width, cam.height);
        this.setUniformf("u_strength", transProgress * transparent);
        this.setUniformf("u_bandScl", maskSoft);
        this.setUniformf("u_rectExpand", rectExpandDist);
        this.setUniformf("u_edge", (edgePx * cam.height) / Core.graphics.getHeight());

        this.setUniformf("u_shapeA", a.x, a.y, a.halfW, a.halfH);
        this.setUniformf("u_shapeB", b.x, b.y, b.halfW, b.halfH);
        this.setUniformf("u_shapeType", a.type, b.type);
    },
});

var transparent = 0.8;
var mouseMaskRadius = Vars.tilesize * 16;
var rectExpandDist = Vars.tilesize * 5;
var maskSoft = 0.5;

var fadeInTime = 0.15;
var fadeOutTime = 1.2;

var maskLogic = true;
var maskGroundUnits = true;


var fadeProgress = 0;
var transProgress = 0;

// type: 0=不用 1=矩形 2=圆
const noShape = {type: 0, x: 0, y: 0, halfW: 0, halfH: 0};
var areaMask = {shape: noShape, frame: -1},
    circleMask = {shape: noShape, frame: -1};

Events.on(ClientLoadEvent, e => {
    changeModDescription();

    addSettings(Vars.ui.settings.graphics);

    Events.run(Trigger.update, () => {
        transparent = Core.settings.getInt("build-xray.transparent") / 100;
        mouseMaskRadius = Core.settings.getInt("build-xray.mouse-mask-radius") * Vars.tilesize;
        fadeInTime = Core.settings.getInt("build-xray.fade-in") / 1000;
        fadeOutTime = Core.settings.getInt("build-xray.fade-out") / 1000;
        rectExpandDist = Core.settings.getInt("build-xray.rect-expand") * Vars.tilesize;
        maskSoft = Core.settings.getInt("build-xray.mask-soft") / 100;
        maskLogic = Core.settings.getBool("build-xray.logic");
        maskGroundUnits = Core.settings.getBool("build-xray.ground-units");
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

        settings.sliderPref("build-xray.transparent", Math.round(transparent * 100), 0, 100, 5, p => p + "%");
        settings.sliderPref("build-xray.mask-soft", Math.round(maskSoft * 100), 0, 100, 5, p => p + "%");
        settings.sliderPref("build-xray.mouse-mask-radius", Math.round(mouseMaskRadius / Vars.tilesize), 4, 32, 4, p =>
            Core.bundle.format("setting.tile", p),
        );
        settings.sliderPref("build-xray.rect-expand", Math.round(rectExpandDist / Vars.tilesize), 0, 15, 1, p =>
            Core.bundle.format("setting.tile", p),
        );
        settings.sliderPref("build-xray.fade-in", Math.round(fadeInTime * 1000), 0, 1000, 50, p =>
            Core.bundle.format("setting.milliseconds", p),
        );
        settings.sliderPref("build-xray.fade-out", Math.round(fadeOutTime * 1000), 0, 3000, 100, p =>
            Core.bundle.format("setting.milliseconds", p),
        );
        settings.checkPref("build-xray.logic", true);
        settings.checkPref("build-xray.ground-units", true);
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
    const isPeeking = Core.input.keyDown(peekBind) && !Core.scene.hasKeyboard();
    const logicArea = maskLogic ? getLogicSelectArea() : null;
    const planArea = getPlanArea();

    const isPlanning =
        isSchematicSelecting ||
        isBreaking ||
        isRebuildSelecting ||
        isPlacingOrDropping ||
        logicArea != null ||
        isPeeking ||
        planArea != null;

    const drawFrame = Core.graphics.getFrameId();

    fadeProgress = Mathf.approachDelta(
        fadeProgress,
        Mathf.num(isPlanning),
        1 / 60 / (isPlanning ? fadeInTime : fadeOutTime),
    );

    if (Mathf.zero(fadeProgress)) {
        transProgress = 0;
        areaMask.shape = circleMask.shape = noShape;
        return;
    }

    transProgress = Interp.smoother.apply(fadeProgress);

    screenBuffer.resize(Core.graphics.getWidth(), Core.graphics.getHeight());

    let areaShape = noShape;

    if (isBreaking) {
        const maxLength =
            isDesktop && Core.input.keyDown(Binding.schematicSelect) && input.schemX != -1 && input.schemY != -1
                ? Vars.maxSchematicSize
                : 100;
        areaShape = areaRectShape(
            isDesktop ? input.selectX : input.lineStartX,
            isDesktop ? input.selectY : input.lineStartY,
            maxLength,
        );
    } else if (isSchematicSelecting) {
        areaShape = areaRectShape(
            isDesktop ? input.schemX : input.lineStartX,
            isDesktop ? input.schemY : input.lineStartY,
            Vars.maxSchematicSize,
        );
    } else if (isRebuildSelecting) {
        areaShape = areaRectShape(
            isDesktop ? input.schemX : input.lineStartX,
            isDesktop ? input.schemY : input.lineStartY,
            0,
        );
    } else if (logicArea != null) {
        areaShape = circleShape(logicArea.x, logicArea.y, logicArea.radius);
    } else if (planArea != null) {
        areaShape = rectShape(planArea.x1, planArea.y1, planArea.x2, planArea.y2);
    }

    if (areaShape !== noShape) {
        areaMask.shape = areaShape;
        areaMask.frame = drawFrame;
    }

    if (isPlacingOrDropping || isPeeking) {
        const {x, y} = Core.input.mouseWorld();
        circleMask.shape = circleShape(x, y, mouseMaskRadius);
        circleMask.frame = drawFrame;
    }

    // 有实时形状的这一帧就丢掉另一类的冻结形状，没有则保留它继续淡出
    if (areaMask.frame === drawFrame || circleMask.frame === drawFrame) {
        if (areaMask.frame !== drawFrame) areaMask.shape = noShape;
        if (circleMask.frame !== drawFrame) circleMask.shape = noShape;
    }

    // beam drill
    applyTrans(Layer.power - 1.001, Layer.power - 0.999);
    // ground / naval units
    if (maskGroundUnits) applyTrans(Layer.groundUnit - 2.001, Layer.groundUnit + 2.001);
    // leg units
    applyTrans(Layer.legUnit - 2.001, Layer.legUnit + 2.001);
    // darkness and unit shadows
    applyTrans(Layer.darkness - 0.001, Layer.darkness + 0.001);
    // flying units
    applyTrans(Layer.flyingUnitLow - 2.001, Layer.flyingUnit + 2.001);

    function applyTrans(zStart, zEnd) {
        Draw.draw(zStart, () => {
            screenBuffer.begin(Color.clear);
        });

        Draw.draw(zEnd, () => {
            screenBuffer.end();
            Blending.normal.apply();
            screenBuffer.blit(transShader);
        });
    }
});

function rectShape(x1, y1, x2, y2) {
    return {type: 1, x: (x1 + x2) / 2, y: (y1 + y2) / 2, halfW: (x2 - x1) / 2, halfH: (y2 - y1) / 2};
}

function circleShape(x, y, radius) {
    return {type: 2, x: x, y: y, halfW: radius, halfH: radius};
}

function areaRectShape(startX, startY, maxLength) {
    if (startX < 0 || startY < 0) return noShape;

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

    return rectShape(result.x, result.y, result.x2, result.y2);
}

function getLogicSelectArea() {
    const input = Vars.control.input;
    const configFrag = input.config;
    if (!configFrag.isShown() || configFrag.getSelected() == null) return;
    const build = configFrag.getSelected();
    if (!(build instanceof LogicBlock.LogicBuild)) return null;

    return {x: build.x, y: build.y, radius: build.block.range};
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

