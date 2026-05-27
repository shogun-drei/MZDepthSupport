/*:
 * @target MZ
 * @plugindesc Adds proper depth buffer support for Effekseer 3D effects.
 * @author shogun_drei
 *
 * @help EffekseerDepthSupport.js
 *
 * Fixes in-game WebGL rendering issues affecting
 * Effekseer 3D particle effects within RPG Maker MZ.
 *
 * Load this plugin AFTER EffekseerForRPGMakerMZ_Ex.
 */

(() => {
    let depthBuffer = null;
    let depthWidth = 0;
    let depthHeight = 0;

    const _Graphics_createPixiApp = Graphics._createPixiApp;
    Graphics._createPixiApp = function() {
        _Graphics_createPixiApp.call(this);

        if (this._app) {
            const gl = this._app.renderer.gl;
            if (gl) {
                const attributes = gl.getContextAttributes();
                if (!attributes || !attributes.depth) {

                    this._app.ticker.remove(this._onTick, this);
                    this._app.destroy(false);

                    this._app = new PIXI.Application({
                        view: this._canvas,
                        autoStart: false,
                        depth: true
                    });
                    this._app.ticker.remove(this._app.render, this._app);
                    this._app.ticker.add(this._onTick, this);
                }
            }
        }
    };

    const param = PluginManager.parameters('EffekseerForRPGMakerMZ_Ex');
    const isDistortionEnabled = param && param['DistortionEnabled'] !== "false" && param['DistortionEnabled'] !== undefined;

    if (!isDistortionEnabled) {
        Sprite_Animation.prototype.setProjectionMatrix = function(renderer) {
            const x = this._mirror ? -1 : 1;
            const y = -1;
            const p = -(this._viewportSize / renderer.view.height);
            const depthCorrection = 10.0 / p; 


            Graphics.effekseer.setProjectionMatrix([
                x, 0, 0, 0,
                0, y, 0, 0,
                0, 0, 1.0, p,
                0, 0, depthCorrection, 1.0
            ]);
        };
    }

    const _Sprite_Animation_render = Sprite_Animation.prototype._render;
    Sprite_Animation.prototype._render = function(renderer) {
        if (this._targets.length > 0 && this._handle && this._handle.exists) {
            const gl = renderer.gl;

            const currentFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
            const isOffscreen = currentFbo !== null;

            if (isOffscreen) {
                if (!depthBuffer) {
                    depthBuffer = gl.createRenderbuffer();
                }
                gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);

                const target = renderer.renderTexture.current;
                const width = target ? target.width : renderer.width;
                const height = target ? target.height : renderer.height;

                if (depthWidth !== width || depthHeight !== height) {
                    const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
                    const internalFormat = isWebGL2 ? gl.DEPTH_COMPONENT24 : gl.DEPTH_COMPONENT16;
                    gl.renderbufferStorage(gl.RENDERBUFFER, internalFormat, width, height);
                    depthWidth = width;
                    depthHeight = height;
                }

                gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
            }

            const originalDepthWrite = gl.getParameter(gl.DEPTH_WRITEMASK);
            const originalDepthTest = gl.isEnabled(gl.DEPTH_TEST);
            const originalDepthFunc = gl.getParameter(gl.DEPTH_FUNC);

            gl.depthMask(true);
            gl.clear(gl.DEPTH_BUFFER_BIT);

            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL);

            const originalFrontFace = gl.getParameter(gl.FRONT_FACE);
            const compensatedFrontFace = originalFrontFace === gl.CW ? gl.CCW : gl.CW;
            gl.frontFace(compensatedFrontFace);

            _Sprite_Animation_render.call(this, renderer);

            gl.frontFace(originalFrontFace);

            gl.depthMask(originalDepthWrite);
            if (!originalDepthTest) {
                gl.disable(gl.DEPTH_TEST);
            }
            gl.depthFunc(originalDepthFunc);

            if (isOffscreen) {
                gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
            }
        } else {
            _Sprite_Animation_render.call(this, renderer);
        }
    };

    const _Graphics_createPixiApp2 = Graphics._createPixiApp;
    Graphics._createPixiApp = function() {
        
        if (depthBuffer) {
            depthBuffer = null;
            depthWidth = 0;
            depthHeight = 0;
        }
        _Graphics_createPixiApp2.call(this);
    };
})();
