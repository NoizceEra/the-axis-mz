/*:
 * @plugindesc THE AXIS — objective line, toasts, and the marsh push-block helper.
 * @author REVUNDA
 * @target MZ
 * @help
 * Three script calls. Everything else in this project is native RPG Maker MZ
 * events, switches, variables and common events, editable in the editor.
 *
 *   AxisExt.objective("text")  set the objective line drawn under the map name.
 *                              An empty string clears it.
 *   AxisExt.toast("text")      brief centred notice, fades after ~3 seconds.
 *   AxisExt.push(eventId)      shove the event one tile in the direction the
 *                              player faces, if that tile is passable. Used by
 *                              the East Marsh stone. Call as:
 *                                 AxisExt.push(this._eventId)
 *
 * No other behaviour is hidden here: the endings, transfers, puzzles, tremor
 * and dialogue are all ordinary event commands.
 */

var AxisExt = AxisExt || {};

(function () {
    var objectiveText = "";
    var toastText = "";
    var toastFrames = 0;

    function makeTextSprite(size, colour) {
        var sprite = new Sprite(new Bitmap(Graphics.width, size + 16));
        sprite.bitmap.fontSize = size;
        sprite.bitmap.textColor = colour;
        sprite.bitmap.outlineColor = "rgba(0,0,0,0.85)";
        sprite.bitmap.outlineWidth = 4;
        return sprite;
    }

    function redrawObjective(scene) {
        var sprite = scene._axisObjective;
        if (!sprite) return;
        sprite.bitmap.clear();
        if (!objectiveText) return;
        sprite.bitmap.drawText("OBJECTIVE  " + objectiveText, 0, 0, Graphics.width - 40, 32, "left");
    }

    function redrawToast(scene) {
        var sprite = scene._axisToast;
        if (!sprite) return;
        sprite.bitmap.clear();
        if (!toastText || toastFrames <= 0) return;
        sprite.bitmap.drawText(toastText, 0, 0, Graphics.width, 32, "center");
        sprite.opacity = Math.min(255, toastFrames * 6);
    }

    AxisExt.objective = function (text) {
        objectiveText = text || "";
        if (SceneManager._scene instanceof Scene_Map) redrawObjective(SceneManager._scene);
    };

    AxisExt.toast = function (text) {
        toastText = text || "";
        toastFrames = 180;
        if (SceneManager._scene instanceof Scene_Map) redrawToast(SceneManager._scene);
    };

    AxisExt.push = function (eventId) {
        var event = $gameMap.event(eventId);
        var player = $gamePlayer;
        if (!event) return false;
        var d = player.direction();
        var dx = d === 6 ? 1 : d === 4 ? -1 : 0;
        var dy = d === 2 ? 1 : d === 8 ? -1 : 0;
        // the player has to be behind the stone, not beside it
        if (player.x !== event.x - dx || player.y !== event.y - dy) {
            $gameMessage.add("You would have to be behind it to push it.");
            return false;
        }
        var tx = event.x + dx;
        var ty = event.y + dy;
        if (!$gameMap.isPassable(tx, ty, d) || $gameMap.eventIdXy(tx, ty) > 0) {
            $gameMessage.add("It will not move that way.");
            return false;
        }
        event.setPosition(tx, ty);
        event.setDirection(d);
        SoundManager.playCursor();
        return true;
    };

    var _Scene_Map_createDisplayObjects = Scene_Map.prototype.createDisplayObjects;
    Scene_Map.prototype.createDisplayObjects = function () {
        _Scene_Map_createDisplayObjects.call(this);
        this._axisObjective = makeTextSprite(18, "#a8a488");
        this._axisObjective.x = 20;
        this._axisObjective.y = Graphics.height - 96;
        this.addChild(this._axisObjective);
        this._axisToast = makeTextSprite(22, "#e8e4cf");
        this._axisToast.x = 0;
        this._axisToast.y = 40;
        this.addChild(this._axisToast);
        redrawObjective(this);
        redrawToast(this);
    };

    var _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _Scene_Map_update.call(this);
        if (toastFrames > 0) {
            toastFrames--;
            redrawToast(this);
        }
    };
})();
