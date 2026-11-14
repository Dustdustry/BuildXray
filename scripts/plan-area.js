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

    // 只统计玩家当前单位 buildRange 内的计划
    const unit = Vars.player.unit();
    if (unit == null) return null;
    const range = unit.type.buildRange;

    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

    const include = plan => {
        if (plan == null) return;
        // getX/getY 就是 drawx/drawy（方块中心），超出 buildRange 的计划不算
        if (!unit.within(plan.getX(), plan.getY(), range)) return;

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
