let playerPlanTreeField = null;

try {
    playerPlanTreeField = InputHandler.__javaObject__.getDeclaredField("playerPlanTree");
    playerPlanTreeField.setAccessible(true);
} catch (e) {
    Log.errTag(
        "build-xray",
        "Failed to get playerPlanTree field, please check if the mod is compatible with this version of Mindustry.",
    );
}

const planRect = new Rect();
const planList = new Seq();

function getPlanArea() {
    if (playerPlanTreeField == null) return null;

    const input = Vars.control.input;

    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

    const include = plan => {
        if (plan == null) return;
        plan.hitbox(planRect);

        minX = Math.min(minX, planRect.x);
        minY = Math.min(minY, planRect.y);
        maxX = Math.max(maxX, planRect.x + planRect.width);
        maxY = Math.max(maxY, planRect.y + planRect.height);
    };

    const planTree = Reflect.get(input, playerPlanTreeField);
    if (planTree != null) {
        planList.clear();
        planTree.getObjects(planList);
        planList.each(include);
    }

    input.linePlans.each(include);
    input.selectPlans.each(include);

    if (minX === Infinity) return null;
    return {x1: minX, x2: maxX, y1: minY, y2: maxY};
}

exports.getPlanArea = getPlanArea;
