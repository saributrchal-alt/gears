<?php
declare(strict_types=1);
ini_set('display_errors','0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');
function reply(int $status,array $data): void {http_response_code($status);echo json_encode($data,JSON_UNESCAPED_SLASHES);exit;}
try {
 $config=require __DIR__.'/config.php';
 $key=$config['upload_key']??'';
 if(!is_string($key)||strlen($key)<32)reply(503,['ok'=>false]);
 if(!hash_equals($key,$_SERVER['HTTP_X_UPLOAD_KEY']??''))reply(401,['ok'=>false]);
 if(($_SERVER['REQUEST_METHOD']??'')!=='POST')reply(405,['ok'=>false]);
 // Outside the document root: the web server cannot serve signature files directly.
 $root=realpath($_SERVER['DOCUMENT_ROOT']??'');
 if(!$root||$root==='/')reply(503,['ok'=>false]);
 // A subdomain may live inside the main site's public_html: escape that too.
 $publicRoot=$root;
 while(basename($publicRoot)!=='public_html'&&dirname($publicRoot)!==$publicRoot)$publicRoot=dirname($publicRoot);
 if(basename($publicRoot)!=='public_html')reply(503,['ok'=>false]);
 $dir=dirname($publicRoot).'/nathoeng-private-signatures';
 if(!is_dir($dir)&&!mkdir($dir,0700,true))reply(503,['ok'=>false]);
 $resolved=realpath($dir);
 if(!$resolved||strpos($resolved.'/', $publicRoot.'/')===0)reply(503,['ok'=>false]);
 $operation=$_POST['operation']??'';
 if($operation==='health')reply(is_writable($dir)&&function_exists('imagecreatefrompng')?200:503,['ok'=>is_writable($dir)&&function_exists('imagecreatefrompng')]);
 if($operation==='read'){
  $id=$_POST['id']??'';if(!is_string($id)||!preg_match('/^[a-f0-9]{32}$/D',$id))reply(400,['ok'=>false]);
  $path=$dir.'/'.$id.'.png';if(!is_file($path))reply(404,['ok'=>false]);
  reply(200,['ok'=>true,'image'=>'data:image/png;base64,'.base64_encode(file_get_contents($path))]);
 }
 if($operation!=='upload')reply(400,['ok'=>false]);
 $file=$_FILES['file']??null;
 if(!$file||$file['error']!==UPLOAD_ERR_OK||!is_uploaded_file($file['tmp_name']))reply(400,['ok'=>false]);
 if(filesize($file['tmp_name'])>200000)reply(413,['ok'=>false]);
 $info=@getimagesize($file['tmp_name']);
 if(!$info||$info[0]!==900||$info[1]!==300||$info[2]!==IMAGETYPE_PNG)reply(422,['ok'=>false]);
 $im=@imagecreatefrompng($file['tmp_name']);if(!$im)reply(422,['ok'=>false]);
 // Reject empty or nearly empty pads; keep only newly encoded pixels.
 $ink=0;for($y=0;$y<300;$y+=2)for($x=0;$x<900;$x+=2){$c=imagecolorsforindex($im,imagecolorat($im,$x,$y));if($c['alpha']<100&&$c['red']+$c['green']+$c['blue']<600)$ink++;}
 if($ink<20){imagedestroy($im);reply(422,['ok'=>false]);}
 $id=bin2hex(random_bytes(16));$path=$dir.'/'.$id.'.png';
 if(!imagepng($im,$path,9))reply(503,['ok'=>false]);imagedestroy($im);chmod($path,0600);
 if(filesize($path)>200000){unlink($path);reply(413,['ok'=>false]);}
 reply(201,['ok'=>true,'url'=>'https://media.nathoeng.com/signatures.php?id='.$id]);
}catch(Throwable $e){error_log('Signature storage: '.get_class($e));reply(503,['ok'=>false]);}
